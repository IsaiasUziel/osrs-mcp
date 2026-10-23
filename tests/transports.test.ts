import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const cwd = fileURLToPath(new URL('..', import.meta.url));
const preload = ['--preload', './tests/fixtures/hiscores-preload.ts'];
const toolNames = ['get_player_stats', 'get_skill_progress', 'get_quest_info'];

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
  const info = await client.callTool({ name: 'get_quest_info', arguments: { quest: 'Synthetic Quest' } });
  expect(info.isError).not.toBe(true);
  const infoContent = info.content as { type: 'text'; text: string }[];
  expect(JSON.parse(infoContent[0]!.text)).toMatchObject({ title: 'Synthetic Quest', rewardedQuestPoints: 3 });
  expect((await client.callTool({ name: 'get_quest_info', arguments: { quest: 'Missing' } })).isError).toBe(true);
  const grouped = await client.callTool({ name: 'get_quest_info', arguments: { quest: 'Alternative Quest' } });
  expect(grouped.isError).not.toBe(true);
  const groupedContent = grouped.content as { type: 'text'; text: string }[];
  expect(JSON.parse(groupedContent[0]!.text).skillRequirements).toEqual([]);
}

describe('stdio MCP', () => {
  it('initializes, lists tools, and preserves tool results and errors', async () => {
    const client = new Client({ name: 'transport-test', version: '1.0.0' });
    try {
      await client.connect(new StdioClientTransport({ command: process.execPath, args: [...preload, 'src/index.ts'], cwd }));
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
      cwd, env: { ...Bun.env, PORT: String(address.port), MCP_BEARER_TOKEN: token }, stdout: 'ignore', stderr: 'ignore'
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
