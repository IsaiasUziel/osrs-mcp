import { describe, expect, it, mock } from 'bun:test';
import { getQuestInfo, parseQuestPage } from '../src/quests.js';
import { questResponse } from './fixtures/quest.js';

describe('Wiki quest guidance', () => {
  it('preserves quest context, rewards, item guidance and revision attribution', () => {
    const result = parseQuestPage(questResponse);
    expect(result.title).toBe('Synthetic Quest');
    expect(result.requirementsWikitext).toContain('10 quest points');
    expect(result.recommendationsWikitext).toContain('Magic|50');
    expect(result.itemsWikitext).toContain('Knife');
    expect(result.walkthroughWikitext).toContain('example shop');
    expect(result.walkthroughWikitext).not.toContain('A Later Quest');
    expect(result.rewardedQuestPoints).toBe(3);
    expect(result.rewardsWikitext).toContain('Example Area');
    expect(result.source).toBe('https://oldschool.runescape.wiki/w/Synthetic_Quest');
    expect(result.revisionUrl).toBe(`${result.source}?oldid=123`);
    expect(result.attribution).toContain('Wiki contributors');
    expect(result.licenseUrl).toBe('https://creativecommons.org/licenses/by-nc-sa/3.0/');
    expect(result.manualRequirements).toEqual(['*[[Another Quest]] and 10 quest points']);
    expect(result.skillRequirements).toEqual([
      { skill: 'Crafting', level: 31, boostable: true, requiredToStart: false },
      { skill: 'Woodcutting', level: 36, boostable: false, requiredToStart: null }
    ]);
  });

  it.each([
    '*{{SCP|Crafting|31}} or {{SCP|Magic|30}}',
    '*{{SCP|Crafting|31}} (optional)',
    '*{{SCP|Crafting|31}}\n**Alternatively use a potion',
    '*{{SCP|Crafting|100}}',
    '*{{SCP|Unknown|31}}'
  ])('keeps ambiguous or unsupported requirements manual: %s', requirement => {
    const input = structuredClone(questResponse);
    input.parse.wikitext = `{{Quest details|requirements = ${requirement}}}`;
    const result = parseQuestPage(input);
    expect(result.skillRequirements).toEqual([]);
    expect(result.manualRequirements).toEqual([requirement]);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('reports missing context as unknown and does not parse commented-out templates', () => {
    const result = parseQuestPage({ parse: { title: 'Partial Quest', revid: 1, sections: [], wikitext: '<!--{{Quest details|requirements = *{{SCP|Magic|99}}}}-->\n{{Quest details|description = Partial}}' } });
    expect(result.requirementsWikitext).toBeNull();
    expect(result.rewardedQuestPoints).toBeNull();
    expect(result.rewardsWikitext).toBeNull();
    expect(result.skillRequirements).toEqual([]);
    expect(result.warnings.join(' ')).toContain('Missing');
  });

  it.each([
    'Either of the following:\n*{{SCP|Crafting|31}}\n*{{SCP|Magic|30}}',
    'One of these skills is required:\n*{{SCP|Crafting|31}}\n*{{SCP|Magic|30}}',
    '*Choose one:\n*{{SCP|Crafting|31}}\n*{{SCP|Magic|30}}'
  ])('preserves list-wide alternative scope instead of asserting mandatory skills', requirements => {
    const input = structuredClone(questResponse);
    input.parse.wikitext = `{{Quest details|requirements = ${requirements}}}`;
    const quest = parseQuestPage(input);
    expect(quest.skillRequirements).toEqual([]);
    expect(quest.manualRequirements).toEqual([requirements]);
  });

  it.each([{}, { parse: { ...questResponse.parse, revid: -1 } }, { parse: { ...questResponse.parse, wikitext: 'Not a quest' } }])('rejects malformed and unsupported pages', input => {
    expect(() => parseQuestPage(input)).toThrow();
  });

  it('uses a fixed public GET endpoint with encoded titles and a deadline', async () => {
    const fetchMock = mock(async (_input: Parameters<typeof fetch>[0], _init?: RequestInit) => Response.json(questResponse));
    const result = await getQuestInfo("  Cook's Assistant  ", Object.assign(fetchMock, { preconnect: fetch.preconnect }));
    const [input, init] = fetchMock.mock.calls[0]!;
    const url = new URL(String(input));
    expect(url.origin + url.pathname).toBe('https://oldschool.runescape.wiki/api.php');
    expect(url.searchParams.get('page')).toBe("Cook's Assistant");
    expect(url.searchParams.get('redirects')).toBe('1');
    expect(url.searchParams.get('prop')).toBe('wikitext|revid|sections');
    expect(init?.method).toBe('GET');
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(init?.headers).toMatchObject({ 'User-Agent': expect.stringContaining('github.com/IsaiasUziel/osrs-mcp') });
    expect(result.fetchedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it.each([403, 429, 503])('surfaces HTTP %s without retries', async status => {
    const fetchMock = mock(async () => new Response('', { status }));
    await expect(getQuestInfo('Synthetic Quest', Object.assign(fetchMock, { preconnect: fetch.preconnect }))).rejects.toThrow(`OSRS Wiki HTTP ${status}`);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each(['not JSON', JSON.stringify({ error: { code: 'missingtitle', info: 'Missing' } }), JSON.stringify({ parse: null })])('rejects invalid or missing Wiki responses', async body => {
    const fetcher = Object.assign(async () => new Response(body), { preconnect: fetch.preconnect });
    await expect(getQuestInfo('Missing', fetcher)).rejects.toThrow();
  });

  it('rejects oversized responses and invalid titles before sending requests', async () => {
    const fetchMock = mock(async () => new Response('x'.repeat(1_048_577)));
    const fetcher = Object.assign(fetchMock, { preconnect: fetch.preconnect });
    await expect(getQuestInfo('Synthetic Quest', fetcher)).rejects.toThrow('too large');
    fetchMock.mockClear();
    await expect(getQuestInfo(' ', fetcher)).rejects.toThrow('Invalid quest title');
    await expect(getQuestInfo('x'.repeat(201), fetcher)).rejects.toThrow('Invalid quest title');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
