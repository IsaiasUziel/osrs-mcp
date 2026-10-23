import { describe, expect, it } from 'bun:test';
import { getItemInfo, parseItemPage } from '../src/items.js';
import { itemResponse } from './fixtures/item.js';

function page(text: string) {
  const value = itemResponse(); value.parse.wikitext = text; return value;
}
const asFetch = (fn: (...args: Parameters<typeof fetch>) => Promise<Response>) => Object.assign(fn, { preconnect: fetch.preconnect });

describe('Wiki item facts', () => {
  it('preserves utility and requirements context separately from literal bonuses with attribution', () => {
    const item = parseItemPage(itemResponse(), '2026-10-23T12:00:00Z');
    expect(item).toMatchObject({ title: 'Synthetic utility hood', revisionId: 456, fetchedAt: '2026-10-23T12:00:00Z', slot: 'head', contentFormat: 'wikitext', contextTruncated: false });
    expect(item.bonuses).toMatchObject({ str: 2, prayer: 0, dstab: 4, amagic: null });
    expect(item.properties).toMatchObject({ tradeable: 'No', quest: 'No', weight: null });
    expect(item.contextWikitext).toContain('Requires a quest');
    expect(item.contextWikitext).toContain('while carried');
    expect(item.contextWikitext).not.toContain('Historical benefit');
    expect(item.revisionUrl).toBe(item.source + '?oldid=456');
    expect(item.attribution).toBe('Old School RuneScape Wiki contributors');
    expect(item.licenseUrl).toContain('by-nc-sa/3.0');
    expect(item.sections[0]?.url).toBe(item.source + '#Benefits');
  });

  it('preserves nested template/link pipes and excludes commented or nowiki facts', () => {
    const item = parseItemPage(page('<!--{{Infobox Item|name=Ignored}}--><nowiki>{{Infobox Item|name=Literal}}</nowiki>{{Infobox Item|name=Example|destroy={{Example|a|b}}|quest=[[Quest|title]]}}'));
    expect(item.properties.destroy).toBe('{{Example|a|b}}');
    expect(item.properties.quest).toBe('[[Quest|title]]');
    expect(Object.values(item.bonuses).every(value => value === null)).toBe(true);
    expect(item.slot).toBeNull();
  });

  it.each(['{{Infobox Item|version1=A|id1=1}}', '{{Infobox Item|id=1}}{{Infobox Item|id=2}}', '{{Infobox Item|id=1|id=2}}', '{{Quest details|items=x}}', '{{Infobox Item|name=broken'])('rejects unsupported or ambiguous item identity: %s', text => {
    expect(() => parseItemPage(page(text))).toThrow();
  });

  it.each(['{{expr|2+3}}', '2 or 3', 'Infinity', '9999999999999999999'])('never evaluates or guesses bonus expressions: %s', bonus => {
    expect(parseItemPage(itemResponse('Example', bonus)).bonuses.str).toBeNull();
  });

  it('does not blend numbered/multiple bonuses or guess an equipment slot', () => {
    for (const extra of ['{{Infobox Bonuses|str=9|slot=head}}', '\n{{Infobox Bonuses|str1=9|slot1=head}}']) {
      const data = itemResponse(); data.parse.wikitext += extra;
      expect(parseItemPage(data).bonuses.str).toBeNull();
      expect(parseItemPage(data).slot).toBeNull();
    }
    expect(parseItemPage(itemResponse('Example', '-0.5')).bonuses.str).toBe(-0.5);
    expect(parseItemPage(itemResponse('Example', '2', '{{slot}}')).slot).toBeNull();
  });

  it('bounds item context and raw properties with explicit unknowns and warnings', () => {
    const item = parseItemPage(page('{{Infobox Item|name=' + 'x'.repeat(1001) + '}}\n' + 'y'.repeat(12001)));
    expect(item.properties.name).toBeNull();
    expect(item.contextWikitext.length).toBe(12000);
    expect(item.contextTruncated).toBe(true);
    expect(item.warnings.some(warning => /truncat/i.test(warning))).toBe(true);
    expect(() => parseItemPage({ parse: { ...itemResponse().parse, revid: -1 } })).toThrow('Invalid OSRS Wiki item response');
  });

  it('uses one encoded fixed-provider GET with no redirects and a deadline', async () => {
    let calls = 0;
    const result = await getItemInfo('  Example & hood  ', asFetch(async (input, init) => {
      calls++;
      const url = new URL(String(input));
      expect(url.origin + url.pathname).toBe('https://oldschool.runescape.wiki/api.php');
      expect(url.searchParams.get('page')).toBe('Example & hood');
      expect(url.searchParams.get('prop')).toBe('wikitext|revid|sections');
      expect(init).toMatchObject({ method: 'GET', redirect: 'error' });
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      expect(new Headers(init?.headers).get('User-Agent')).toContain('https://github.com/IsaiasUziel/osrs-mcp');
      return Response.json(itemResponse());
    }));
    expect(calls).toBe(1); expect(result.title).toBe('Synthetic utility hood');
  });

  it('rejects invalid titles before making a request', async () => {
    let calls = 0;
    for (const title of ['', ' ', 'x'.repeat(201), 'x\n', 'x\x00y']) {
      await expect(getItemInfo(title, asFetch(async () => { calls++; return Response.json(itemResponse()); }))).rejects.toThrow('Invalid item title');
    }
    expect(calls).toBe(0);
  });

  it('fails explicitly for HTTP, API, malformed, oversized and transport responses', async () => {
    for (const [response, message] of [
      [new Response('', { status: 429 }), 'OSRS Wiki HTTP 429'],
      [Response.json({ error: { code: 'missingtitle' } }), 'Item page not found'],
      [Response.json({ error: { code: 'other' } }), 'OSRS Wiki API error'],
      [new Response('{'), 'Invalid OSRS Wiki JSON'],
      [Response.json({}), 'Invalid OSRS Wiki item response'],
      [new Response('x'.repeat(1048577)), 'OSRS Wiki response too large']
    ] as const) {
      await expect(getItemInfo('Example', asFetch(async () => response))).rejects.toThrow(message);
    }
    await expect(getItemInfo('Example', asFetch(async () => { throw new Error('offline'); }))).rejects.toThrow('offline');
  });
});
