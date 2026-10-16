import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { requireChat } from '../../actions/context.js';
import { effectiveStatus } from '../../domain/pending.js';
import { listPending } from '../../store/pending-query.js';
import type { MessageRow } from '../../store/types.js';
import { readHistory } from '../../sync/backfill.js';
import { resolveSenders } from '../../sync/senders.js';
import { toMessageRow } from '../../sync/update-sink.js';
import { formatChat, formatMessage, formatPending, type MessageView } from '../format.js';
import { run } from '../result.js';
import type { ToolDeps } from '../server.js';
import { READ } from './annotations.js';

const chatId = z.number().int().describe('Chat id from list_chats or get_pending');
const chatType = z.enum(['user', 'bot', 'group', 'supergroup', 'channel']);
const watchLevel = z.enum(['full', 'normal', 'muted']);

async function withSenders(d: ToolDeps, rows: MessageRow[]): Promise<MessageView[]> {
  const ids = rows.filter((m) => !m.out).map((m) => m.senderId);
  const senders = await resolveSenders({ gateway: d.actions.gateway, senders: d.senders, chats: d.actions.chats, now: d.actions.now }, ids);
  return rows.map((m) => formatMessage(m, senders));
}

export function registerReadTools(server: McpServer, d: ToolDeps): void {
  server.registerTool(
    'status',
    { description: 'Paperplane health: Telegram auth state (ok, connecting, or auth_required), last live update, last sweep, store size. Local reads work in every state; Telegram calls need ok.', inputSchema: {}, annotations: READ },
    () => run(() => d.status()),
  );

  server.registerTool(
    'list_chats',
    {
      description: 'List chats from the local mirror, most recent first. Filter by type, watch level, unread, archived, or title/username text.',
      inputSchema: {
        type: chatType.optional(),
        watch_level: watchLevel.optional(),
        unread_only: z.boolean().optional(),
        archived: z.boolean().optional(),
        query: z.string().min(1).max(256).optional().describe('Case-insensitive match on title or username'),
        limit: z.number().int().min(1).max(200).default(50),
        offset: z.number().int().min(0).max(100000).default(0),
      },
      annotations: READ,
    },
    (a) =>
      run(() =>
        d.actions.chats
          .list({ type: a.type, watchLevel: a.watch_level, unreadOnly: a.unread_only, archived: a.archived, query: a.query, limit: a.limit, offset: a.offset })
          .map(formatChat),
      ),
  );

  server.registerTool(
    'get_pending',
    {
      description:
        "Chats waiting on the user's reply: DMs whose last message is theirs, and groups on full watch with activity since the user's last message (normal groups and channels never count). 'seen' means the user read it but didn't answer. Full-watch chats first, then newest incoming message first. Excludes muted chats, bots, Telegram's service account and chats labeled done/waiting/snoozed.",
      inputSchema: { limit: z.number().int().min(1).max(100).default(30) },
      annotations: READ,
    },
    (a) => run(() => listPending(d.db, d.actions.now(), { limit: a.limit }).map(formatPending)),
  );

  server.registerTool(
    'read_history',
    {
      description:
        'Messages in a chat, newest first. Paginate backwards with before_id (the smallest id you already have). Fetches from Telegram when the local mirror is short. Set refresh=true to re-fetch the page from Telegram first: use it when senders are missing names or links look stripped (messages mirrored before those were kept).',
      inputSchema: {
        chat_id: chatId,
        limit: z.number().int().min(1).max(200).default(50),
        before_id: z.number().int().positive().optional(),
        refresh: z.boolean().default(false),
      },
      annotations: { ...READ, openWorldHint: true },
    },
    (a) => run(async () => withSenders(d, await readHistory(d.backfill, a.chat_id, { limit: a.limit, beforeId: a.before_id, refresh: a.refresh }))),
  );

  server.registerTool(
    'search_messages',
    {
      description: 'Full-text search over mirrored messages (words matched literally). Set remote=true to search Telegram itself, which covers history that was never mirrored.',
      inputSchema: {
        query: z.string().min(1).max(256),
        chat_id: chatId.optional(),
        limit: z.number().int().min(1).max(100).default(30),
        remote: z.boolean().default(false),
      },
      annotations: { ...READ, openWorldHint: true },
    },
    (a) =>
      run(async () => {
        if (!a.remote) return withSenders(d, d.actions.messages.search(a.query, { chatId: a.chat_id, limit: a.limit }));
        const found = await d.actions.gateway.search({ query: a.query, chatId: a.chat_id, limit: a.limit });
        // Remote results carry their senders already; no lookup needed.
        const senders = new Map(found.flatMap((m) => (m.sender ? [[m.sender.id, { ...m.sender, updatedAt: 0 }] as const] : [])));
        return found.map((m) => ({ chatId: m.chat.id, chatTitle: m.chat.title, ...formatMessage(toMessageRow(m, false), senders) }));
      }),
  );

  server.registerTool(
    'get_chat_info',
    { description: 'One chat with its status, label and watch level.', inputSchema: { chat_id: chatId }, annotations: READ },
    (a) =>
      run(() => {
        const chat = requireChat(d.actions, a.chat_id);
        const label = d.labels.get(chat.id);
        return { ...formatChat(chat), status: effectiveStatus(chat, label, d.actions.now()), label };
      }),
  );
}
