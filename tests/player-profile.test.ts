import { describe, expect, it, mock } from 'bun:test';
import { getPlayerProfile } from '../src/player-profile.js';
import { getPlayerStats } from '../src/hiscores.js';

const clock = () => new Date('2026-10-23T12:00:00Z');
const recent = { username: 'uzgorak', type: 'regular', build: 'main', updatedAt: '2026-10-23T10:00:00Z' };
function fixture(data: unknown, status = 200) {
  const call = mock(async (_input: Parameters<typeof fetch>[0], _init?: RequestInit) => Response.json(data, { status }));
  return { call, fetcher: Object.assign(call, { preconnect: fetch.preconnect }) };
}

describe('Public player profile', () => {
  it.each(['regular', 'ironman', 'hardcore', 'ultimate'])('reports a recent supported %s type without deriving it from build', async type => {
    const { fetcher } = fixture({ ...recent, type });
    const result = await getPlayerProfile('Uzgorak', fetcher, clock);
    expect(result.accountType).toBe(type);
    expect(result.reportedAccountType).toBe(type);
    expect(result.recordFreshness).toBe('recent');
    expect(result.confirmationRequired).toBe(false);
    expect(result.providerUpdatedAt).toBe(recent.updatedAt);
    expect(result.fetchedAt).toBe(clock().toISOString());
    expect(result.lookupStatus).toBe('found');
  });

  it('preserves stale reports but does not present them as current account types', async () => {
    const { fetcher } = fixture({ ...recent, updatedAt: '2026-09-06T02:52:41.242Z' });
    const result = await getPlayerProfile('Uzgorak', fetcher, clock);
    expect(result.accountType).toBe('unknown');
    expect(result.reportedAccountType).toBe('regular');
    expect(result.recordFreshness).toBe('stale');
    expect(result.confirmationRequired).toBe(true);
    expect(result.maxRecordAgeDays).toBe(7);
  });

  it.each([undefined, null, 'not-a-date', '2026-10-24T12:00:00Z'])('keeps invalid or unavailable record freshness unknown: %s', async updatedAt => {
    const { fetcher } = fixture({ ...recent, updatedAt });
    const result = await getPlayerProfile('Uzgorak', fetcher, clock);
    expect(result.accountType).toBe('unknown');
    expect(result.recordFreshness).toBe('unknown');
    expect(result.confirmationRequired).toBe(true);
  });

  it.each(['unknown', 'group_ironman'])('does not convert unsupported or unknown types into main: %s', async type => {
    const { fetcher } = fixture({ ...recent, type, build: 'main' });
    const result = await getPlayerProfile('Uzgorak', fetcher, clock);
    expect(result.accountType).toBe('unknown');
    expect(result.reportedAccountType).toBe(type);
    expect(result.confirmationRequired).toBe(true);
  });

  it.each([
    ['2026-10-16T12:00:00Z', 'recent'],
    ['2026-10-16T11:59:59.999Z', 'stale']
  ] as const)('applies the documented seven-day age boundary: %s', async (updatedAt, freshness) => {
    const { fetcher } = fixture({ ...recent, updatedAt });
    expect((await getPlayerProfile('Uzgorak', fetcher, clock)).recordFreshness).toBe(freshness);
  });

  it('does not reinterpret invalid JSON as a regular account', async () => {
    const fetcher = Object.assign(async () => new Response('not JSON'), { preconnect: fetch.preconnect });
    expect((await getPlayerProfile('Uzgorak', fetcher, clock)).lookupStatus).toBe('invalid_response');
  });

  it.each([403, 404, 429, 503])('returns explicit unknown for HTTP %s without creating or updating tracking', async status => {
    const { call, fetcher } = fixture({ message: 'Unavailable' }, status);
    const result = await getPlayerProfile('Uzgorak', fetcher, clock);
    expect(result.accountType).toBe('unknown');
    expect(result.reportedAccountType).toBeNull();
    expect(result.lookupStatus).toBe(status === 404 ? 'not_found' : 'unavailable');
    expect(result.confirmationRequired).toBe(true);
    expect(call).toHaveBeenCalledTimes(1);
    expect(call.mock.calls[0]![1]?.method).toBe('GET');
  });

  it.each([{}, { ...recent, username: 'someoneelse' }, { ...recent, type: 1 }])('rejects incomplete, mismatched or malformed profiles', async data => {
    const { fetcher } = fixture(data);
    const result = await getPlayerProfile('Uzgorak', fetcher, clock);
    expect(result.accountType).toBe('unknown');
    expect(result.lookupStatus).toBe('invalid_response');
  });

  it('bounds input and response size, and does not leak transport failures', async () => {
    const oversized = Object.assign(async () => new Response('x'.repeat(1_048_577)), { preconnect: fetch.preconnect });
    expect((await getPlayerProfile('Uzgorak', oversized, clock)).lookupStatus).toBe('invalid_response');
    const broken = Object.assign(async () => { throw new Error('private diagnostic'); }, { preconnect: fetch.preconnect });
    const result = await getPlayerProfile('Uzgorak', broken, clock);
    expect(result.lookupStatus).toBe('unavailable');
    expect(JSON.stringify(result)).not.toContain('private diagnostic');
    const { call, fetcher } = fixture(recent);
    for (const rsn of ['', 'invalid!', 'longerthan12chars']) {
      await expect(getPlayerProfile(rsn, fetcher, clock)).rejects.toThrow('Invalid RSN');
      await expect(getPlayerStats(rsn, fetcher)).rejects.toThrow('Invalid RSN');
    }
    expect(call).not.toHaveBeenCalled();
  });

  it('uses an encoded fixed-provider GET, a deadline and honest source dates', async () => {
    const { call, fetcher } = fixture({ ...recent, username: 'other player', type: 'ironman' });
    const result = await getPlayerProfile('  Other Player  ', fetcher, clock);
    expect(result.rsn).toBe('Other Player');
    expect(result.source).toBe('https://api.wiseoldman.net/v2/players/Other%20Player');
    expect(call.mock.calls[0]![0]).toBe(result.source);
    expect(call.mock.calls[0]![1]).toMatchObject({ method: 'GET', redirect: 'error', signal: expect.any(AbortSignal) });
    expect(call.mock.calls[0]![1]?.headers).toMatchObject({ 'User-Agent': expect.stringContaining('github.com/IsaiasUziel/osrs-mcp') });
    expect(result.warnings.join(' ')).toContain('restrictions');
  });
});
