import { createServer } from './server.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createServer as createHttpServer } from 'node:http';

const port = Number(process.env.PORT ?? 3000);
const token = process.env.MCP_BEARER_TOKEN;
if (!token) throw new Error('Set MCP_BEARER_TOKEN before starting HTTP transport');
const allowedOrigins = new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`]);

createHttpServer(async (req, res) => {
  if (req.url !== '/mcp') { res.writeHead(404).end(); return; }
  if (req.headers.authorization !== `Bearer ${token}`) { res.writeHead(401).end(); return; }
  // Non-browser MCP clients may omit Origin; browser origins must match exactly.
  if (req.headers.origin !== undefined && !allowedOrigins.has(req.headers.origin)) {
    res.writeHead(403).end(); return;
  }
  if (req.method !== 'POST') { res.writeHead(405, { Allow: 'POST' }).end(); return; }
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  const server = createServer();
  res.on('close', () => { void transport.close(); void server.close(); });
  try { await server.connect(transport); await transport.handleRequest(req, res); }
  catch (err) { console.error(err); if (!res.headersSent) res.writeHead(500).end(); }
}).listen(port, '127.0.0.1', () => console.error(`OSRS MCP listening on http://127.0.0.1:${port}/mcp`));
