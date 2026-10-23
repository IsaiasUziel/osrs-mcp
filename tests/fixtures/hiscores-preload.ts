import { SKILLS } from '../../src/hiscores.js';
import { alternativeQuestResponse, questResponse } from './quest.js';

const csv = SKILLS.map((_, i) => `-1,${i === 0 ? 100 : 1},${i === 0 ? 1000 : 0}`).join('\n');

// Only child MCP processes load this fixture; the test runner's fetch stays real.
globalThis.fetch = Object.assign(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.origin === 'https://oldschool.runescape.wiki' && url.pathname === '/api.php') {
    if (init?.method !== 'GET' || url.searchParams.get('action') !== 'parse') throw new Error('Expected read-only Wiki parse request');
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
