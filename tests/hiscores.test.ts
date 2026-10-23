import { describe, it, expect, mock } from 'bun:test';
import { SKILLS, parseHiscores, getPlayerStats, xpForLevel, getSkillProgress } from '../src/hiscores.js';

const fixture = SKILLS.map((_, i) => `-1,${i === 0 ? 100 : 1},${i === 0 ? 1000 : 0}`).join('\n');
describe('Hiscores', () => {
  it('parses skills by canonical order', () => {
    const skills = parseHiscores(fixture);
    expect(skills).toHaveLength(SKILLS.length);
    expect(skills[1]).toEqual({ name: 'Attack', rank: null, level: 1, xp: 0 });
  });
  it('rejects incomplete payloads', () => expect(() => parseHiscores('1,1,0')).toThrow());
  it('fetches and encodes RSN', async () => {
    const fetchMock = mock(async (_input: Parameters<typeof fetch>[0], _init?: RequestInit) => new Response(fixture));
    const fetcher = Object.assign(fetchMock, { preconnect: fetch.preconnect });
    const result = await getPlayerStats('Uzgorak', fetcher);
    expect(result.rsn).toBe('Uzgorak');
    expect(fetchMock.mock.calls[0]![0]).toContain('player=Uzgorak');
  });
  it('calculates canonical XP', () => {
    expect(xpForLevel(1)).toBe(0);
    expect(xpForLevel(2)).toBe(83);
    expect(xpForLevel(99)).toBe(13034431);
  });
  it('computes remaining XP', () => {
    const stats = { rsn: 'Uzgorak', fetchedAt: '2026-01-01', source: 'test', skills: parseHiscores(fixture) };
    expect(getSkillProgress(stats, 'Attack', 2).xpRemaining).toBe(83);
  });
});
