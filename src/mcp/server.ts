import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ActionDeps } from '../actions/context.js';
import type { Db } from '../store/db.js';
import type { LabelsRepo } from '../store/labels-repo.js';
import type { BackfillDeps } from '../sync/backfill.js';
import type { SweepReport } from '../sync/sweep.js';
import { registerDestructiveTools } from './tools/destructive.js';
import { registerMessagingTools } from './tools/messaging.js';
import { registerOrganizeTools } from './tools/organize.js';
import { registerReadTools } from './tools/read.js';
import { registerTrackingTools } from './tools/tracking.js';

export interface StatusReport {
  auth: 'ok' | 'auth_required';
  lastUpdateAt: string | null;
  lastSweepAt: string | null;
  lastSweep: SweepReport | null;
  chats: number;
  messages: number;
}

export interface ToolDeps {
  actions: ActionDeps;
  db: Db;
  labels: LabelsRepo;
  backfill: BackfillDeps;
  status: () => StatusReport;
}

export function buildServer(deps: ToolDeps): McpServer {
  const server = new McpServer({ name: 'paperplane', version: '0.1.0' });
  registerReadTools(server, deps);
  registerTrackingTools(server, deps);
  registerMessagingTools(server, deps);
  registerOrganizeTools(server, deps);
  registerDestructiveTools(server, deps);
  return server;
}
