import { itemResponse } from './item.js';
import { SKILLS } from '../../src/hiscores.js';
import { alternativeQuestResponse, questResponse } from './quest.js';

const csv = SKILLS.map((_, i) => `-1,${i === 0 ? 100 : 1},${i === 0 ? 1000 : 0}`).join('\n');

// Only child MCP processes load this fixture; the test runner's fetch stays real.
globalThis.fetch = Object.assign(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.origin === 'https://sync.runescape.wiki' && url.pathname.startsWith('/runelite/player/')) {
    if (init?.method !== 'GET' || init.redirect !== 'error') throw new Error('Expected bounded read-only WikiSync lookup');
    return Response.json({ username: decodeURIComponent(url.pathname.split('/')[3]!), timestamp: new Date().toISOString(),
      combat_achievements: [4, 8], quests: { 'Composite Quest': 2, 'Provider Quest': 2 } });
  }
  if (url.origin === 'https://api.wiseoldman.net' && url.pathname.startsWith('/v2/players/')) {
    if (init?.method !== 'GET') throw new Error('Expected read-only player lookup');
    const name = decodeURIComponent(url.pathname.slice('/v2/players/'.length));
    if (name === 'Missing') return Response.json({ message: 'Missing' }, { status: 404 });
    return Response.json({ username: name.toLowerCase(), type: name === 'Other Player' ? 'ironman' : 'regular', build: 'main', updatedAt: name === 'Stale' ? '2000-01-01T00:00:00Z' : new Date().toISOString() });
  }
  if (url.origin === 'https://oldschool.runescape.wiki' && url.pathname === '/api.php') {
    if (init?.method !== 'GET' || url.searchParams.get('action') !== 'parse') throw new Error('Expected read-only Wiki parse request');
    if (url.searchParams.get('page') === 'Synthetic combat helm') return Response.json(itemResponse('Synthetic combat helm', '+5'));
    if (url.searchParams.get('page') === 'Synthetic utility hood') return Response.json(itemResponse());
    if (url.searchParams.get('page') === 'Alternative Quest') return Response.json(alternativeQuestResponse);
    return Response.json(url.searchParams.get('page') === 'Missing' ? { error: { code: 'missingtitle' } } : questResponse);
  }
  if (url.hostname !== 'secure.runescape.com') throw new Error(`Unexpected upstream: ${url.hostname}`);
  const rsn = url.searchParams.get('player');
  if (rsn === 'Missing') return new Response('', { status: 404 });
  if (rsn === 'Unavailable') return new Response('', { status: 503 });
  if (rsn === 'Uzgorak' || rsn === 'Other Player') return new Response(csv);
  throw new Error(`Unexpected RSN: ${rsn}`);
}, { preconnect: fetch.preconnect });
