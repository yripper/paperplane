import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { requireChat } from '../../actions/context.js';
import { AppError } from '../../domain/errors.js';
import { run } from '../result.js';
import type { ToolDeps } from '../server.js';
import { LOCAL_WRITE } from './annotations.js';

// Telegram recommends polling at most ~10 channels; full chats get background backfill.
const FULL_WATCH_SOFT_LIMIT = 10;

export function registerTrackingTools(server: McpServer, d: ToolDeps): void {
  server.registerTool(
    'set_label',
    {
      description:
        "Label a chat locally (never visible in Telegram). done = handled, waiting = ball is in their court, snoozed = hide until snooze_until. A new incoming message clears done/waiting automatically.",
      inputSchema: {
        chat_id: z.number().int(),
        label: z.enum(['snoozed', 'done', 'waiting']),
        snooze_until: z.iso.datetime({ offset: true }).max(40).optional().describe('Required for snoozed, ISO 8601'),
        note: z.string().max(500).optional(),
      },
      annotations: LOCAL_WRITE,
    },
    (a) =>
      run(() => {
        requireChat(d.actions, a.chat_id);
        const now = d.actions.now();
        let snoozeUntil: number | null = null;
        if (a.label === 'snoozed') {
          if (!a.snooze_until) throw new AppError('VALIDATION', 'snoozed needs snooze_until');
          snoozeUntil = Math.floor(Date.parse(a.snooze_until) / 1000);
          if (snoozeUntil <= now) throw new AppError('VALIDATION', 'snooze_until must be in the future');
        }
        const label = { chatId: a.chat_id, label: a.label, snoozeUntil, note: a.note ?? null, updatedAt: now };
        d.labels.set(label);
        return label;
      }),
  );

  server.registerTool(
    'clear_label',
    { description: 'Remove a chat label so its status is automatic again.', inputSchema: { chat_id: z.number().int() }, annotations: LOCAL_WRITE },
    (a) =>
      run(() => {
        requireChat(d.actions, a.chat_id);
        d.labels.clear(a.chat_id);
        return { ok: true };
      }),
  );

  server.registerTool(
    'set_watch_level',
    {
      description: 'full = keep complete history and list first in pending; normal = store new messages; muted = metadata only, never pending.',
      inputSchema: { chat_id: z.number().int(), level: z.enum(['full', 'normal', 'muted']) },
      annotations: LOCAL_WRITE,
    },
    (a) =>
      run(() => {
        requireChat(d.actions, a.chat_id);
        d.actions.chats.setWatchLevel(a.chat_id, a.level, d.actions.now());
        const fullCount = d.actions.chats.list({ watchLevel: 'full', limit: 1000, offset: 0 }).length;
        return {
          ok: true,
          ...(fullCount > FULL_WATCH_SOFT_LIMIT
            ? { warning: `${fullCount} chats are on full watch; Telegram recommends polling at most ${FULL_WATCH_SOFT_LIMIT}` }
            : {}),
        };
      }),
  );
}
