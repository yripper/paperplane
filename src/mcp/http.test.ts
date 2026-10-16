import { request } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { hostAllowed, type RunningHttp, startHttpServer, tokenMatches } from './http.js';

const TOKEN = 'test-token-123';
let running: RunningHttp;

function send(opts: { method?: string; path?: string; headers?: Record<string, string>; body?: string }): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request(
      { host: '127.0.0.1', port: running.port, method: opts.method ?? 'POST', path: opts.path ?? '/mcp', headers: opts.headers },
      (res) => {
        let body = '';
        res.on('data', (c: Buffer) => (body += c.toString()));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
      },
    );
    req.on('error', reject);
    req.end(opts.body);
  });
}

const auth = (): Record<string, string> => ({ authorization: `Bearer ${TOKEN}`, host: `127.0.0.1:${running.port}` });

beforeEach(async () => {
  running = await startHttpServer({ port: 0, token: TOKEN, log: () => {}, buildServer: () => new McpServer({ name: 'paperplane', version: '0.1.0' }) });
});

afterEach(async () => {
  await running.close();
});

describe('startHttpServer', () => {
  it('rejects requests without the bearer token', async () => {
    expect((await send({ headers: { host: `127.0.0.1:${running.port}` } })).status).toBe(401);
  });

  it('rejects foreign Host headers (DNS rebinding)', async () => {
    expect((await send({ headers: { ...auth(), host: `evil.example:${running.port}` } })).status).toBe(403);
  });

  it('only serves /mcp', async () => {
    expect((await send({ path: '/other', headers: auth() })).status).toBe(404);
  });

  it('rejects non-POST methods', async () => {
    expect((await send({ method: 'GET', headers: auth() })).status).toBe(405);
  });

  it('answers an MCP initialize request', async () => {
    const res = await send({
      headers: { ...auth(), 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1.0.0' } },
      }),
    });
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body).result.serverInfo.name).toBe('paperplane');
  });
});

describe('tokenMatches / hostAllowed', () => {
  it('compares the full bearer header', () => {
    expect(tokenMatches(`Bearer ${TOKEN}`, TOKEN)).toBe(true);
    expect(tokenMatches(`Bearer ${TOKEN}x`, TOKEN)).toBe(false);
    expect(tokenMatches(undefined, TOKEN)).toBe(false);
  });

  it('allows only loopback hosts on the right port', () => {
    expect(hostAllowed('127.0.0.1:7777', 7777)).toBe(true);
    expect(hostAllowed('localhost:7777', 7777)).toBe(true);
    expect(hostAllowed('localhost:7778', 7777)).toBe(false);
    expect(hostAllowed(undefined, 7777)).toBe(false);
  });
});
