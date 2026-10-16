import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { buildInstructions } from '../mcp/instructions.js';
import { buildServer, type ToolDeps } from '../mcp/server.js';
import { makeActionDeps } from './action-deps.js';

export function makeToolDeps(): { deps: ToolDeps; t: ReturnType<typeof makeActionDeps> } {
  const t = makeActionDeps();
  const deps: ToolDeps = {
    actions: t.deps,
    db: t.store.db,
    labels: t.store.labels,
    senders: t.store.senders,
    backfill: { gateway: t.gateway, chats: t.store.chats, messages: t.store.messages, cursors: t.store.cursors, sink: t.deps.sink },
    status: () => ({ auth: 'ok', lastUpdateAt: null, lastSweepAt: null, lastSweep: null, chats: t.store.chats.count(), messages: t.store.messages.count() }),
  };
  return { deps, t };
}

export async function connect(deps: ToolDeps): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '1.0.0' });
  await Promise.all([buildServer(deps, buildInstructions(null)).connect(serverTransport), client.connect(clientTransport)]);
  return client;
}
