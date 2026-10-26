import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { createServer } from 'node:net';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { questSnapshot } from './fixtures/quest-snapshot.js';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const cwd = fileURLToPath(new URL('..', import.meta.url));
const preload = ['--preload', './tests/fixtures/hiscores-preload.ts'];
const toolNames = ['get_player_stats', 'get_skill_progress', 'get_quest_info', 'get_quest_skill_gaps', 'get_player_profile', 'get_item_info', 'compare_items', 'get_quest_status', 'get_player_progress', 'refresh_player_snapshot'];

const snapshotDirectory = await mkdtemp(join(tmpdir(), 'osrs-status-transports-'));
for (const rsn of ['Uzgorak', 'Other Player']) {
  await writeFile(join(snapshotDirectory, `${rsn.toLowerCase().replace(/ /g, '_')}-quest-snapshot.json`), JSON.stringify(questSnapshot(rsn)));
}
afterAll(() => rm(snapshotDirectory, { recursive: true, force: true }));
const childEnvironment = Object.fromEntries(Object.entries(Bun.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
childEnvironment.OSRS_MCP_PLAYER_DATA_DIR = snapshotDirectory;

async function checkTools(client: Client) {
  const { tools } = await client.listTools();
  expect(tools.map(tool => tool.name)).toEqual(toolNames);
  expect(tools.slice(0, 2).map(tool => tool.inputSchema)).toEqual([
    { type: 'object', properties: { rsn: { type: 'string', default: 'Uzgorak' } }, additionalProperties: false, $schema: 'http://json-schema.org/draft-07/schema#' },
    {
      type: 'object',
      properties: { rsn: { type: 'string', default: 'Uzgorak' }, skill: { type: 'string' }, targetLevel: { type: 'integer', minimum: 1, maximum: 99 } },
      required: ['skill', 'targetLevel'], additionalProperties: false, $schema: 'http://json-schema.org/draft-07/schema#'
    }
  ]);
  for (const rsn of [undefined, 'Other Player']) {
    const stats = await client.callTool({ name: 'get_player_stats', arguments: rsn ? { rsn } : {} });
    expect(stats.isError).not.toBe(true);
    expect(stats.content).toEqual([{ type: 'text', text: expect.any(String) }]);
    const content = stats.content as { type: 'text'; text: string }[];
    expect(JSON.parse(content[0]!.text)).toMatchObject({ rsn: rsn ?? 'Uzgorak', skills: expect.any(Array) });
  }
  const progress = await client.callTool({ name: 'get_skill_progress', arguments: { skill: 'Attack', targetLevel: 2 } });
  expect(progress.isError).not.toBe(true);
  const content = progress.content as { type: 'text'; text: string }[];
  expect(JSON.parse(content[0]!.text)).toMatchObject({ rsn: 'Uzgorak', skill: 'Attack', xpRemaining: 83 });
  for (const [targetLevel, message] of [
    [0, 'Number must be greater than or equal to 1'],
    [100, 'Number must be less than or equal to 99'],
    [1.5, 'Expected integer, received float']
  ] as const) {
    expect(await client.callTool({ name: 'get_skill_progress', arguments: { skill: 'Attack', targetLevel } })).toEqual({
      isError: true,
      content: [{ type: 'text', text: `MCP error -32602: Input validation error: Invalid arguments for tool get_skill_progress: ${message} at targetLevel` }]
    });
  }
  for (const rsn of ['Missing', 'Unavailable', 'invalid!']) {
    expect((await client.callTool({ name: 'get_player_stats', arguments: { rsn } })).isError).toBe(true);
  }
  for (const name of ['get_quest_info', 'get_quest_skill_gaps']) {
    const result = await client.callTool({ name, arguments: { quest: 'Synthetic Quest' } });
    expect(result.isError).not.toBe(true);
    const content = result.content as { type: 'text'; text: string }[];
    const value = JSON.parse(content[0]!.text);
    if (name === 'get_quest_info') {
      expect(value.title).toBe('Synthetic Quest');
      expect(value.rewardedQuestPoints).toBe(3);
    } else {
      expect(value.rsn).toBe('Uzgorak');
      expect(value.eligibility).toBe('unknown');
      expect(value.skills[0].status).toBe('below_base_level');
      const explicit = await client.callTool({ name, arguments: { quest: 'Synthetic Quest', rsn: 'Other Player' } });
      const explicitContent = explicit.content as { type: 'text'; text: string }[];
      expect(JSON.parse(explicitContent[0]!.text).rsn).toBe('Other Player');
    }
    expect((await client.callTool({ name, arguments: { quest: 'Missing' } })).isError).toBe(true);
    const grouped = await client.callTool({ name, arguments: { quest: 'Alternative Quest' } });
    expect(grouped.isError).not.toBe(true);
    const groupedContent = grouped.content as { type: 'text'; text: string }[];
    const groupedValue = JSON.parse(groupedContent[0]!.text);
    expect(name === 'get_quest_info' ? groupedValue.skillRequirements : groupedValue.skills).toEqual([]);
  }
  const item = await client.callTool({ name: 'get_item_info', arguments: { item: 'Synthetic utility hood' } });
  expect(item.isError).not.toBe(true);
  const itemContent = item.content as { type: 'text'; text: string }[];
  expect(JSON.parse(itemContent[0]!.text)).toMatchObject({ title: 'Synthetic utility hood', slot: 'head', bonuses: { str: 2 } });
  for (const item of ['Missing', 'Synthetic Quest', 'invalid\n']) {
    expect((await client.callTool({ name: 'get_item_info', arguments: { item } })).isError).toBe(true);
  }
  for (const rsn of [undefined, 'Other Player']) {
    const comparison = await client.callTool({ name: 'compare_items', arguments: { item: 'Synthetic utility hood', against: 'Synthetic combat helm', ...(rsn ? { rsn } : {}) } });
    expect(comparison.isError).not.toBe(true);
    const content = comparison.content as { type: 'text'; text: string }[];
    const value = JSON.parse(content[0]!.text);
    expect(value).toMatchObject({ rsn: rsn ?? 'Uzgorak', sameSlot: true, equipEligibility: 'unknown', ownership: 'unknown', disposalRecommendation: 'unknown' });
    expect(value.bonuses.find((bonus: { key: string }) => bonus.key === 'str').difference).toBe(3);
    expect(value.item.contextWikitext).toContain('while carried');
  }
  for (const args of [
    { item: 'Missing', against: 'Synthetic combat helm' },
    { item: 'Synthetic utility hood', against: 'Missing' },
    { item: 'Synthetic utility hood', against: 'Synthetic combat helm', rsn: 'Missing' },
    { item: 'Synthetic utility hood', against: 'Synthetic combat helm', rsn: 'invalid!' }
  ]) expect((await client.callTool({ name: 'compare_items', arguments: args })).isError).toBe(true);
  for (const rsn of [undefined, 'Other Player']) {
    const result = await client.callTool({ name: 'get_quest_status', arguments: { quest: 'Earlier Quest', ...(rsn ? { rsn } : {}) } });
    expect(result.isError).not.toBe(true);
    const content = result.content as { type: 'text'; text: string }[];
    expect(JSON.parse(content[0]!.text)).toMatchObject({ rsn: rsn ?? 'Uzgorak', status: 'completed', basis: 'user_confirmed_inference', verifiedAgainstGameApi: false });
  }
  const absent = await client.callTool({ name: 'get_quest_status', arguments: { quest: 'Not Recorded' } });
  expect(absent.isError).not.toBe(true);
  expect((absent.content as { text: string }[])[0]!.text).toContain('"status":"unknown"');
  expect((await client.callTool({ name: 'get_quest_status', arguments: { quest: 'Earlier Quest', rsn: '../secret' } })).isError).toBe(true);
  for (const [rsn, accountType] of [[undefined, 'regular'], ['Other Player', 'ironman'], ['Missing', 'unknown'], ['Stale', 'unknown']] as const) {
    const profile = await client.callTool({ name: 'get_player_profile', arguments: rsn ? { rsn } : {} });
    expect(profile.isError).not.toBe(true);
    const content = profile.content as { type: 'text'; text: string }[];
    expect(JSON.parse(content[0]!.text)).toMatchObject({ rsn: rsn ?? 'Uzgorak', accountType, confirmationRequired: accountType === 'unknown' });
  }
  const reader = tools.find(tool => tool.name === 'get_player_progress')!;
  const refresher = tools.find(tool => tool.name === 'refresh_player_snapshot')!;
  expect(reader.annotations?.readOnlyHint).toBe(true);
  expect(refresher.annotations?.readOnlyHint).toBe(false);
  for (const rsn of [undefined, 'Other Player']) {
    const args = rsn ? { rsn } : {};
    const refresh = await client.callTool({ name: 'refresh_player_snapshot', arguments: { ...args, sections: ['combat_achievements', 'quests'] } });
    expect(refresh.isError).not.toBe(true);
    const value = JSON.parse((refresh.content as { text: string }[])[0]!.text);
    expect(['fresh', 'refreshed']).toContain(value.outcome);
    const progress = await client.callTool({ name: 'get_player_progress', arguments: { ...args, section: 'combat_achievements' } });
    expect(progress.isError).not.toBe(true);
    expect(JSON.parse((progress.content as { text: string }[])[0]!.text)).toMatchObject({ rsn: rsn ?? 'Uzgorak', data: [4, 8], maxAgeDays: 3, freshness: 'fresh' });
    const quests = await client.callTool({ name: 'get_player_progress', arguments: { ...args, section: 'quests' } });
    expect(JSON.parse((quests.content as { text: string }[])[0]!.text)).toMatchObject({ data: { 'Composite Quest': null } });
  }
  expect((await client.callTool({ name: 'refresh_player_snapshot', arguments: { sections: [] } })).isError).toBe(true);
  expect((await client.callTool({ name: 'get_player_progress', arguments: { section: 'unknown' } })).isError).toBe(true);
  expect((await client.callTool({ name: 'refresh_player_snapshot', arguments: { rsn: '../secret', sections: ['quests'] } })).isError).toBe(true);
}

describe('stdio MCP', () => {
  it('initializes, lists tools, and preserves tool results and errors', async () => {
    const client = new Client({ name: 'transport-test', version: '1.0.0' });
    try {
      await client.connect(new StdioClientTransport({ command: process.execPath, args: [...preload, 'src/index.ts'], cwd, env: childEnvironment }));
      await checkTools(client);
    } finally {
      await client.close();
    }
  });
});

describe('HTTP MCP', () => {
  let process: ReturnType<typeof Bun.spawn> | undefined;
  let url: URL;
  const token = crypto.randomUUID();
  const headers = { Authorization: `Bearer ${token}` };

  beforeAll(async () => {
    // Ask the OS for a free port rather than sharing a fixed test port.
    const reservation = createServer();
    await new Promise<void>(resolve => reservation.listen(0, '127.0.0.1', resolve));
    const address = reservation.address();
    if (!address || typeof address === 'string') throw new Error('No test port available');
    url = new URL(`http://127.0.0.1:${address.port}/mcp`);
    await new Promise<void>((resolve, reject) => reservation.close(error => error ? reject(error) : resolve()));
    process = Bun.spawn([Bun.which('bun')!, ...preload, 'src/http.ts'], {
      cwd, env: { ...childEnvironment, PORT: String(address.port), MCP_BEARER_TOKEN: token }, stdout: 'ignore', stderr: 'ignore'
    });
    for (let i = 0; i < 100; i++) {
      if (process.exitCode !== null) throw new Error(`HTTP child exited: ${process.exitCode}`);
      try { if ((await fetch(url)).status === 401) return; } catch { /* Wait for startup. */ }
      await Bun.sleep(20);
    }
    throw new Error('HTTP startup timed out');
  });

  afterAll(async () => {
    process?.kill();
    if (process) await process.exited;
  });

  it('initializes, lists tools, and preserves tool results and errors', async () => {
    const client = new Client({ name: 'transport-test', version: '1.0.0' });
    try {
      await client.connect(new StreamableHTTPClientTransport(url, { requestInit: { headers } }));
      await checkTools(client);
    } finally {
      await client.close();
    }
  });

  it('keeps authentication, routing, and method checks', async () => {
    expect((await fetch(url, { method: 'POST' })).status).toBe(401);
    expect((await fetch(url, { method: 'POST', headers: { Authorization: 'Bearer wrong' } })).status).toBe(401);
    expect((await fetch(new URL('/other', url), { headers })).status).toBe(404);
    const response = await fetch(url, { headers });
    expect(response.status).toBe(405);
    expect(response.headers.get('Allow')).toBe('POST');
  });

  function initialize(origin?: string) {
    return fetch(url, {
      method: 'POST',
      headers: { ...headers, Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json', ...(origin === undefined ? {} : { Origin: origin }) },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'origin-test', version: '1' } } })
    });
  }

  it('rejects untrusted, opaque, and malformed origins even with valid authentication', async () => {
    for (const origin of ['https://not-trusted.invalid', 'null', `${url.origin}.evil`, `${url.origin}/`]) {
      const response = await initialize(origin);
      expect(response.status).toBe(403);
      await response.text();
    }
  });

  it('accepts no Origin and exact loopback origins', async () => {
    for (const origin of [undefined, url.origin, `http://localhost:${url.port}`]) {
      const response = await initialize(origin);
      expect(response.status).toBe(200);
      expect(await response.text()).toContain('protocolVersion');
    }
  });
});
