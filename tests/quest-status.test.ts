import { afterAll, describe, expect, it } from 'bun:test';
import { mkdtemp, writeFile, readFile, rm, symlink, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { getQuestStatus } from '../src/quest-status.js';
import { questSnapshot } from './fixtures/quest-snapshot.js';

const root = await mkdtemp(join(tmpdir(), 'osrs-status-test-'));
afterAll(() => rm(root, { recursive: true, force: true }));
let counter = 0;
async function setup(data: unknown = questSnapshot()) {
  const directory = join(root, String(++counter)); await mkdir(directory);
  const file = join(directory, 'uzgorak-quest-snapshot.json');
  await writeFile(file, typeof data === 'string' ? data : JSON.stringify(data));
  return { directory, file };
}

describe('Local manual quest status', () => {
  it('returns observed and inferred states with honest provenance and no file mutation', async () => {
    const { directory, file } = await setup(); const before = await readFile(file);
    expect(await getQuestStatus(' Synthetic_Quest ', undefined, directory)).toMatchObject({ rsn: 'Uzgorak', quest: 'Synthetic_Quest', status: 'in_progress', basis: 'user_snapshot', snapshotStatus: 'loaded', recordedAt: '2026-10-23T12:00:00Z', observedAt: null, verifiedAgainstGameApi: false });
    expect(await getQuestStatus('Pending Quest', undefined, directory)).toMatchObject({ status: 'not_started', basis: 'user_snapshot' });
    expect(await getQuestStatus('Earlier Quest', undefined, directory)).toMatchObject({ status: 'completed', basis: 'user_confirmed_inference' });
    expect(await getQuestStatus('New Quest', undefined, directory)).toMatchObject({ status: 'unknown', reason: 'not_recorded' });
    expect(await readFile(file)).toEqual(before);
  });

  it('requires enabled and user-confirmed inference without blocking observed records', async () => {
    for (const disabled of ['policy', 'confirmation']) {
      const data = questSnapshot();
      if (disabled === 'policy') data.inferencePolicy.enabled = false;
      else data.provenance.exhaustiveUnfinishedList = 'not_confirmed';
      const { directory } = await setup(data);
      expect(await getQuestStatus('Earlier Quest', undefined, directory)).toMatchObject({ status: 'unknown', reason: 'inference_not_confirmed' });
      expect((await getQuestStatus('Synthetic Quest', undefined, directory)).status).toBe('in_progress');
    }
  });

  it('preserves incomplete composite overrides and refuses excluded or conflicting completions', async () => {
    const data = questSnapshot();
    data.inferredCompletedQuests.push({ name: 'Composite Quest', questKey: 'COMPOSITE_QUEST', status: 'completed' });
    const { directory } = await setup(data);
    expect(await getQuestStatus('Composite Quest', undefined, directory)).toMatchObject({ status: 'unknown', completion: 'incomplete', basis: 'snapshot_override' });
    data.questOverrides = [];
    const excluded = await setup(data);
    expect(await getQuestStatus('Composite Quest', undefined, excluded.directory)).toMatchObject({ status: 'unknown', reason: 'excluded_from_inference' });
    const { questKey: omitted, ...withoutKey } = data.inferredCompletedQuests[1]!;
    const missingKey = await setup({ ...data, inferredCompletedQuests: [withoutKey] });
    expect(await getQuestStatus('Composite Quest', undefined, missingKey.directory)).toMatchObject({ status: 'unknown', reason: 'excluded_from_inference' });
    data.observedEntries.push({ name: 'Earlier Quest', questKey: 'EARLIER_QUEST', status: 'not_started', kind: 'P2P' });
    const conflicting = await setup(data);
    expect(await getQuestStatus('Earlier Quest', undefined, conflicting.directory)).toMatchObject({ status: 'unknown', reason: 'conflicting_records' });
  });

  it('binds snapshots to the requested player and normalizes underscores only for identity', async () => {
    const { directory } = await setup(questSnapshot('Someone Else'));
    const result = await getQuestStatus('Synthetic Quest', undefined, directory);
    expect(result).toMatchObject({ status: 'unknown', snapshotStatus: 'player_mismatch' });
    expect(JSON.stringify(result)).not.toContain('Someone Else');
    await writeFile(join(directory, 'a_b-quest-snapshot.json'), JSON.stringify(questSnapshot('A B')));
    expect(await getQuestStatus('Synthetic Quest', 'A  B', directory)).toMatchObject({ status: 'unknown', snapshotStatus: 'missing' });
    await writeFile(join(directory, 'other_player-quest-snapshot.json'), JSON.stringify(questSnapshot('Other_Player')));
    expect(await getQuestStatus('Synthetic Quest', ' Other Player ', directory)).toMatchObject({ rsn: 'Other Player', status: 'in_progress' });
  });

  it('keeps missing, malformed, oversized and unsupported snapshots unknown without leaking paths', async () => {
    expect(await getQuestStatus('Quest', 'Missing', root)).toMatchObject({ status: 'unknown', snapshotStatus: 'missing' });
    for (const data of ['{', 'x'.repeat(1048577), {}, { ...questSnapshot(), schemaVersion: 2 }, { ...questSnapshot(), provenance: { verifiedAgainstGameApi: true } }]) {
      const { directory } = await setup(data);
      const result = await getQuestStatus('Synthetic Quest', undefined, directory);
      expect(result).toMatchObject({ status: 'unknown', snapshotStatus: 'invalid' });
      expect(JSON.stringify(result)).not.toContain(directory);
    }
  });

  it('rejects symlinks, directories and FIFOs without reading or waiting for a writer', async () => {
    const original = await setup(); const dir = join(root, String(++counter)); await mkdir(dir);
    await symlink(original.file, join(dir, 'uzgorak-quest-snapshot.json'));
    expect((await getQuestStatus('Synthetic Quest', undefined, dir)).snapshotStatus).toBe('invalid');
    const folder = join(root, String(++counter)); await mkdir(join(folder, 'uzgorak-quest-snapshot.json'), { recursive: true });
    expect((await getQuestStatus('Synthetic Quest', undefined, folder)).snapshotStatus).toBe('invalid');
    const pipe = join(root, String(++counter)); await mkdir(pipe);
    expect(await Bun.spawn(['mkfifo', join(pipe, 'uzgorak-quest-snapshot.json')]).exited).toBe(0);
    expect((await getQuestStatus('Synthetic Quest', undefined, pipe)).snapshotStatus).toBe('invalid');
  });

  it('rejects invalid titles and traversal-like RSNs before any file lookup', async () => {
    for (const quest of ['', ' ', 'x'.repeat(201), 'x\n']) await expect(getQuestStatus(quest, 'Uzgorak', root)).rejects.toThrow('Invalid quest title');
    for (const rsn of ['../secret', '', 'x'.repeat(13)]) await expect(getQuestStatus('Quest', rsn, root)).rejects.toThrow('Invalid RSN');
  });
});
