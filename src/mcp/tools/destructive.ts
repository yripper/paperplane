import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { applyCleanupPlan, createCleanupPlan } from '../../actions/cleanup.js';
import { blockUser, deleteChat, leaveChat } from '../../actions/destructive.js';
import { run } from '../result.js';
import type { ToolDeps } from '../server.js';
import { DESTRUCTIVE, READ } from './annotations.js';

export function registerDestructiveTools(server: McpServer, d: ToolDeps): void {
  server.registerTool(
    'delete_chat',
    {
      description:
        "Delete a private chat or basic group. mode: delete = remove for the user only; clear = empty history, keep the chat; revoke = delete for EVERYONE (requires confirm_title equal to the chat's exact title). Confirm with the user first.",
      inputSchema: {
        chat_id: z.number().int(),
        mode: z.enum(['delete', 'clear', 'revoke']).default('delete'),
        confirm_title: z.string().max(256).optional(),
      },
      annotations: DESTRUCTIVE,
    },
    (a) => run(() => deleteChat(d.actions, { chatId: a.chat_id, mode: a.mode, confirmTitle: a.confirm_title })),
  );

  server.registerTool(
    'leave_chat',
    { description: 'Leave a group, supergroup or channel. Confirm with the user first.', inputSchema: { chat_id: z.number().int() }, annotations: DESTRUCTIVE },
    (a) => run(() => leaveChat(d.actions, { chatId: a.chat_id })),
  );

  server.registerTool(
    'block_user',
    { description: 'Block a user. Confirm with the user first.', inputSchema: { user_id: z.number().int().positive() }, annotations: DESTRUCTIVE },
    (a) => run(() => blockUser(d.actions, { userId: a.user_id })),
  );

  // READ on purpose: planning only stores a draft, so allowlisting it is safe.
  server.registerTool(
    'cleanup_plan',
    {
      description:
        'Step 1 of bulk cleanup: list chats matching ALL given criteria, without changing anything. At least one criterion is required. Full-watch chats are never included. A plan holds at most 20 chats: `matched` is the total that matched, so when it exceeds `count`, apply this plan and then call cleanup_plan again for the rest. Show the numbered list to the user, then call cleanup_apply with their exclusions. Remove mode pauses about a second between chats. Plans expire after 30 minutes.',
      inputSchema: {
        inactive_days: z.number().int().min(1).max(3650).optional(),
        types: z.array(z.enum(['user', 'bot', 'group', 'supergroup', 'channel'])).min(1).max(5).optional(),
        min_unread: z.number().int().min(1).max(100000).optional(),
        muted_only: z.boolean().optional(),
        archived_only: z.boolean().optional(),
        mode: z.enum(['remove', 'archive']).default('remove'),
      },
      annotations: READ,
    },
    (a) =>
      run(() => {
        const plan = createCleanupPlan(
          d.actions,
          { inactiveDays: a.inactive_days, types: a.types, minUnread: a.min_unread, mutedOnly: a.muted_only, archivedOnly: a.archived_only },
          a.mode,
        );
        return {
          planId: plan.id,
          expiresAt: new Date(plan.expiresAt * 1000).toISOString(),
          mode: plan.mode,
          count: plan.items.length,
          matched: plan.matched,
          items: plan.items.map((item, i) => ({ n: i + 1, ...item })),
        };
      }),
  );

  server.registerTool(
    'cleanup_apply',
    {
      description: 'Step 2 of bulk cleanup: execute a plan from cleanup_plan, minus exclude_chat_ids. Single-use. Only call after the user approved the list. Returns {done, failed, skipped}: each failed entry has a code (NOT_FOUND = the chat is gone, FORBIDDEN = it was promoted to full watch since planning, otherwise the error code of the Telegram call); skipped = not attempted because of a rate limit or flood wait in remove mode, so plan again for those. Archive mode is one call: a rate limit rejects it with RATE_LIMITED and the plan stays usable, and skipped is always empty.',
      inputSchema: { plan_id: z.string().min(1).max(64), exclude_chat_ids: z.array(z.number().int()).max(1000).optional() },
      annotations: DESTRUCTIVE,
    },
    (a) => run(() => applyCleanupPlan(d.actions, a.plan_id, a.exclude_chat_ids ?? [])),
  );
}
