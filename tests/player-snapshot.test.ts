import { afterAll, describe, expect, it } from 'bun:test';
import { mkdtemp, readFile, writeFile, mkdir, rm, symlink, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { getPlayerProgress, refreshPlayerSnapshot } from '../src/player-snapshot.js';
import { questSnapshot } from './fixtures/quest-snapshot.js';

const root = await mkdtemp(join(tmpdir(), 'osrs-player-snapshot-'));
afterAll(() => rm(root, { recursive: true, force: true }));
let count = 0;
const start = new Date('2026-01-01T12:00:00Z');
const expiry = new Date('2026-01-04T12:00:00Z');
const filename = 'test_player-wikisync-snapshot.json';
const payload = () => ({
  username: 'Test_Player', timestamp: start.toISOString(),
  combat_achievements: [4, 8], quests: { 'Synthetic Quest': 0, 'Provider Quest': 2 },
  achievement_diaries: { Synthetic: { Easy: { complete: false, tasks: [true, false] } } }
});
async function setup() {
  const directory = join(root, String(++count)); await mkdir(directory);
  const calls: { input: string; init?: RequestInit }[] = [];
  const fetcher = Object.assign(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    calls.push({ input: String(input), init }); return Response.json(payload());
  }, { preconnect: fetch.preconnect });
  return { directory, calls, fetcher, clock: () => start };
}

describe('local-first player snapshots', () => {
  it('reads missing and saved sections locally without fetching or creating files', async () => {
    const o = await setup();
    expect(await getPlayerProgress('combat_achievements', 'Test Player', o)).toMatchObject({ snapshotStatus: 'missing', data: null });
    await expect(readFile(join(o.directory, filename))).rejects.toThrow();
    await refreshPlayerSnapshot(['combat_achievements'], 'Test Player', false, o);
    expect(await getPlayerProgress('combat_achievements', 'Test Player', o)).toMatchObject({
      snapshotStatus: 'loaded', freshness: 'fresh', data: [4, 8], expiresAt: expiry.toISOString(), providerUpdatedAt: null
    });
    expect(o.calls).toHaveLength(1);
    expect((await stat(join(o.directory, filename))).mode & 0o777).toBe(0o600);
  });

  it('skips fresh refreshes, expires at exactly three days, and allows explicit force', async () => {
    const o = await setup();
    await refreshPlayerSnapshot(['combat_achievements'], 'Test Player', false, o);
    const bytes = await readFile(join(o.directory, filename));
    expect(await refreshPlayerSnapshot(['combat_achievements'], 'Test Player', false, o)).toMatchObject({ outcome: 'fresh', updatedSections: [] });
    expect(o.calls).toHaveLength(1); expect(await readFile(join(o.directory, filename))).toEqual(bytes);
    const later = { ...o, clock: () => expiry };
    expect(await getPlayerProgress('combat_achievements', 'Test Player', later)).toMatchObject({ freshness: 'stale' });
    expect(await refreshPlayerSnapshot(['combat_achievements'], 'Test Player', false, later)).toMatchObject({ outcome: 'refreshed' });
    expect(await refreshPlayerSnapshot(['combat_achievements'], 'Test Player', true, later)).toMatchObject({ outcome: 'refreshed' });
    expect(o.calls).toHaveLength(3);
  });

  it('fetches once for selected sections and does not update unselected or fresh sections', async () => {
    const o = await setup();
    await refreshPlayerSnapshot(['quests', 'combat_achievements'], 'Test Player', false, o);
    expect(o.calls).toHaveLength(1);
    expect(o.calls[0]!.input).toBe('https://sync.runescape.wiki/runelite/player/Test%20Player/STANDARD');
    expect(o.calls[0]!.init).toMatchObject({ method: 'GET', redirect: 'error' });
    const before = JSON.parse(await readFile(join(o.directory, filename), 'utf8'));
    expect(await getPlayerProgress('achievement_diaries', 'Test Player', o)).toMatchObject({ snapshotStatus: 'missing' });
    await refreshPlayerSnapshot(['quests', 'achievement_diaries'], 'Test Player', false, o);
    const after = JSON.parse(await readFile(join(o.directory, filename), 'utf8'));
    expect(after.sections.quests).toEqual(before.sections.quests);
    expect(after.sections.combat_achievements).toEqual(before.sections.combat_achievements);
    expect(await getPlayerProgress('achievement_diaries', 'Test Player', o)).toMatchObject({ data: payload().achievement_diaries });
  });

  it('preserves the manual snapshot byte-for-byte and applies explicit quest overrides', async () => {
    const o = await setup(), manual = questSnapshot('Test Player');
    manual.questOverrides.push({ name: 'Synthetic Quest', questKey: 'SYNTHETIC_QUEST', status: 'completed', completion: 'completed' });
    const file = join(o.directory, 'test_player-quest-snapshot.json');
    const original = JSON.stringify(manual); await writeFile(file, original);
    await refreshPlayerSnapshot(['quests'], 'Test Player', false, o);
    expect(await getPlayerProgress('quests', 'Test Player', o)).toMatchObject({
      data: { 'Synthetic Quest': 2, 'Provider Quest': 2, 'Composite Quest': null },
      manualQuestOverrides: expect.arrayContaining([expect.objectContaining({ name: 'Synthetic Quest', status: 'completed' })])
    });
    expect(await readFile(file, 'utf8')).toBe(original);
  });

  it('retains the previous snapshot on upstream failures, null data, malformed data and wrong identity', async () => {
    const o = await setup(); await refreshPlayerSnapshot(['combat_achievements'], 'Test Player', false, o);
    const file = join(o.directory, filename), before = await readFile(file);
    for (const response of [
      new Response('', { status: 429, headers: { 'Retry-After': '3600' } }),
      new Response('', { status: 503 }), new Response('not json'),
      Response.json({ ...payload(), combat_achievements: null }),
      Response.json({ ...payload(), combat_achievements: [4, 4] }),
      Response.json({ ...payload(), username: 'Someone Else' }),
      new Response('x'.repeat(1_048_577))
    ]) {
      let calls = 0;
      const fetcher = Object.assign(async () => { calls++; return response; }, { preconnect: fetch.preconnect });
      expect((await refreshPlayerSnapshot(['combat_achievements'], 'Test Player', true, { ...o, fetcher })).outcome).not.toBe('refreshed');
      expect(calls).toBe(1); expect(await readFile(file)).toEqual(before);
    }
    const fetcher = Object.assign(async () => { throw new Error('network'); }, { preconnect: fetch.preconnect });
    expect(await refreshPlayerSnapshot(['combat_achievements'], 'Test Player', true, { ...o, fetcher })).toMatchObject({ outcome: 'unavailable' });
    expect(await readFile(file)).toEqual(before);
  });

  it('validates every selected section before atomically replacing any existing data', async () => {
    const o = await setup(); await refreshPlayerSnapshot(['combat_achievements'], 'Test Player', false, o);
    const file = join(o.directory, filename), before = await readFile(file);
    const fetcher = Object.assign(async () => Response.json({ ...payload(), quests: { Broken: 9 } }), { preconnect: fetch.preconnect });
    expect((await refreshPlayerSnapshot(['combat_achievements', 'quests'], 'Test Player', true, { ...o, fetcher })).outcome).toBe('invalid_response');
    expect(await readFile(file)).toEqual(before);
    expect((await refreshPlayerSnapshot(['combat_achievements'], 'Test Player', true, { ...o, fetcher })).outcome).toBe('refreshed');
  });

  it('refuses invalid snapshots, symlinks and concurrent writers without upstream calls', async () => {
    const o = await setup(), file = join(o.directory, filename);
    await writeFile(file, 'invalid');
    expect((await refreshPlayerSnapshot(['quests'], 'Test Player', false, o)).outcome).toBe('invalid_snapshot');
    expect(await readFile(file, 'utf8')).toBe('invalid');
    await rm(file); const target = join(root, 'protected'); await writeFile(target, 'protected'); await symlink(target, file);
    expect((await refreshPlayerSnapshot(['quests'], 'Test Player', false, o)).outcome).toBe('invalid_snapshot');
    expect(await readFile(target, 'utf8')).toBe('protected');
    await rm(file); await writeFile(`${file}.lock`, 'existing lock');
    expect((await refreshPlayerSnapshot(['quests'], 'Test Player', false, o)).outcome).toBe('busy');
    expect(o.calls).toHaveLength(0);
    expect(await readFile(`${file}.lock`, 'utf8')).toBe('existing lock');
    const link = join(root, 'linked-directory'); await symlink(o.directory, link);
    expect((await refreshPlayerSnapshot(['quests'], 'Test Player', false, { ...o, directory: link })).outcome).toBe('invalid_snapshot');
  });

  it('rejects invalid input before I/O and never treats future fetch dates as fresh', async () => {
    const o = await setup();
    for (const rsn of ['../secret', '', 'x'.repeat(13)]) await expect(refreshPlayerSnapshot(['quests'], rsn, false, o)).rejects.toThrow('Invalid RSN');
    await expect(refreshPlayerSnapshot([], 'Test Player', false, o)).rejects.toThrow();
    await expect(refreshPlayerSnapshot(['quests', 'quests'], 'Test Player', false, o)).rejects.toThrow();
    await expect(refreshPlayerSnapshot(['unknown' as 'quests'], 'Test Player', false, o)).rejects.toThrow();
    expect(o.calls).toHaveLength(0);
    await refreshPlayerSnapshot(['quests'], 'Test Player', false, o);
    expect(await getPlayerProgress('quests', 'Test Player', { ...o, clock: () => new Date(start.getTime() - 1) })).toMatchObject({ freshness: 'unknown' });
  });

  it('serializes real concurrent refresh calls and releases its own lock', async () => {
    const o = await setup();
    let entered!: () => void, release!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    let calls = 0;
    const fetcher = Object.assign(async () => { calls++; entered(); await gate; return Response.json(payload()); }, { preconnect: fetch.preconnect });
    const first = refreshPlayerSnapshot(['quests'], 'Test Player', false, { ...o, fetcher });
    await started;
    expect((await refreshPlayerSnapshot(['quests'], 'Test Player', false, { ...o, fetcher })).outcome).toBe('busy');
    release(); expect((await first).outcome).toBe('refreshed'); expect(calls).toBe(1);
    await expect(readFile(join(o.directory, `${filename}.lock`))).rejects.toThrow();
  });

  it('withholds provider-only quest states if manual overrides cannot be validated', async () => {
    const o = await setup(); await refreshPlayerSnapshot(['quests'], 'Test Player', false, o);
    await writeFile(join(o.directory, 'test_player-quest-snapshot.json'), 'invalid');
    expect(await getPlayerProgress('quests', 'Test Player', o)).toMatchObject({ snapshotStatus: 'invalid', data: null });
  });

  it('keeps contradictory manual overrides unknown rather than selecting the last record', async () => {
    const o = await setup(), manual = questSnapshot('Test Player');
    manual.questOverrides.push(
      { name: 'Synthetic Quest', questKey: 'SYNTHETIC_QUEST', status: 'completed', completion: 'completed' },
      { name: 'Synthetic Quest', questKey: 'SYNTHETIC_QUEST', status: 'not_started', completion: 'incomplete' }
    );
    await writeFile(join(o.directory, 'test_player-quest-snapshot.json'), JSON.stringify(manual));
    await refreshPlayerSnapshot(['quests'], 'Test Player', false, o);
    expect(await getPlayerProgress('quests', 'Test Player', o)).toMatchObject({ data: { 'Synthetic Quest': null } });
  });
});
