import { describe, expect, it } from 'bun:test';
import { compareItemFacts, getItemComparison } from '../src/item-comparison.js';
import { parseItemPage } from '../src/items.js';
import { parseHiscores, SKILLS } from '../src/hiscores.js';
import { itemResponse } from './fixtures/item.js';

const csv = SKILLS.map(() => '-1,55,166636').join('\n');
const stats = { rsn: 'Example', source: 'https://example.invalid/hiscores', fetchedAt: '2026-10-23T12:00:00Z', skills: parseHiscores(csv) };
const asFetch = (fn: (...args: Parameters<typeof fetch>) => Promise<Response>) => Object.assign(fn, { preconnect: fetch.preconnect });

describe('Character-aware item comparison', () => {
  it('returns directed bonus differences without equating combat stats with overall usefulness', () => {
    const first = parseItemPage(itemResponse());
    const second = parseItemPage(itemResponse('Synthetic combat helm', '+5'));
    const result = compareItemFacts(first, second, stats);
    expect(result).toMatchObject({ rsn: 'Example', sameSlot: true, differenceDirection: 'against_minus_item', equipEligibility: 'unknown', ownership: 'unknown', disposalRecommendation: 'unknown', accountType: 'unknown' });
    expect(result.bonuses.find(bonus => bonus.key === 'str')).toEqual({ key: 'str', item: 2, against: 5, difference: 3 });
    expect(result.bonuses.find(bonus => bonus.key === 'amagic')?.difference).toBeNull();
    expect(result.item.contextWikitext).toContain('while carried');
    expect(result.against.contextWikitext).toContain('Requires a quest');
    expect(result.playerSkills).toEqual(stats.skills);
    expect(result.statsSource).toBe(stats.source);
    expect(result.statsFetchedAt).toBe(stats.fetchedAt);
    expect(compareItemFacts(second, first, stats).bonuses.find(bonus => bonus.key === 'str')?.difference).toBe(-3);
  });

  it('does not compare different or unknown slots, and permits known zero differences', () => {
    const first = parseItemPage(itemResponse());
    for (const slot of ['body', '{{unknown}}']) {
      const result = compareItemFacts(first, parseItemPage(itemResponse('Other', '+5', slot)), stats);
      expect(result.sameSlot).toBe(false);
      expect(result.bonuses.every(bonus => bonus.difference === null)).toBe(true);
    }
    expect(compareItemFacts(first, first, stats).bonuses.find(bonus => bonus.key === 'str')?.difference).toBe(0);
  });

  it('retrieves exactly two item snapshots and one public character snapshot', async () => {
    const urls: URL[] = [];
    const fetcher = asFetch(async input => {
      const url = new URL(String(input)); urls.push(url);
      if (url.hostname === 'secure.runescape.com') return new Response(csv);
      return Response.json(itemResponse(url.searchParams.get('page')!, url.searchParams.get('page') === 'Other' ? '+5' : '+2'));
    });
    const result = await getItemComparison(' First ', ' Other ', ' Other Player ', fetcher);
    expect(result.rsn).toBe('Other Player');
    expect(result.item.title).toBe('First'); expect(result.against.title).toBe('Other');
    expect(urls.map(url => url.searchParams.get('page') ?? url.searchParams.get('player'))).toEqual(['First', 'Other', 'Other Player']);
    const defaultResult = await getItemComparison('First', 'Other', undefined, fetcher);
    expect(defaultResult.rsn).toBe('Uzgorak');
  });

  it('validates both titles and RSN before any upstream call', async () => {
    let calls = 0;
    const fetcher = asFetch(async () => { calls++; return Response.json(itemResponse()); });
    for (const [item, against, rsn] of [['', 'Other', 'Example'], ['First', 'x\n', 'Example'], ['First', 'Other', 'invalid!']]) {
      await expect(getItemComparison(item!, against!, rsn!, fetcher)).rejects.toThrow();
    }
    expect(calls).toBe(0);
  });

  it('returns an error rather than inventing a personalized comparison when a source fails', async () => {
    for (const failedCall of [1, 2, 3]) {
      let calls = 0;
      const fetcher = asFetch(async input => {
        calls++;
        if (calls === failedCall) return new Response('', { status: 503 });
        return String(input).includes('secure.runescape.com') ? new Response(csv) : Response.json(itemResponse());
      });
      await expect(getItemComparison('First', 'Other', 'Example', fetcher)).rejects.toThrow('HTTP 503');
      expect(calls).toBe(failedCall);
    }
  });
});
