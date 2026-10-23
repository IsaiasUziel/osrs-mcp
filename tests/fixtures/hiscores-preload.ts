import { SKILLS } from '../../src/hiscores.js';

const csv = SKILLS.map((_, i) => `-1,${i === 0 ? 100 : 1},${i === 0 ? 1000 : 0}`).join('\n');

// Only child MCP processes load this fixture; the test runner's fetch stays real.
globalThis.fetch = Object.assign(async (input: Parameters<typeof fetch>[0]) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.hostname !== 'secure.runescape.com') throw new Error(`Unexpected upstream: ${url.hostname}`);
  const rsn = url.searchParams.get('player');
  if (rsn === 'Missing') return new Response('', { status: 404 });
  if (rsn === 'Unavailable') return new Response('', { status: 503 });
  if (rsn === 'Uzgorak' || rsn === 'Other Player') return new Response(csv);
  throw new Error(`Unexpected RSN: ${rsn}`);
}, { preconnect: fetch.preconnect });
