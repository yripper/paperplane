import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { markRead, saveDraft, sendMessage } from '../../actions/messaging.js';
import { toMessageRow } from '../../sync/update-sink.js';
import { formatMessage } from '../format.js';
import { run } from '../result.js';
import type { ToolDeps } from '../server.js';
import { TELEGRAM_WRITE } from './annotations.js';

const text = z.string().min(1).max(4096);

export function registerMessagingTools(server: McpServer, d: ToolDeps): void {
  server.registerTool(
    'send_message',
    {
      description:
        'Send a Telegram message AS THE USER. Always show the user the exact text and chat first and only call after they explicitly approve.',
      inputSchema: { chat_id: z.number().int(), text, reply_to: z.number().int().positive().optional() },
      annotations: TELEGRAM_WRITE,
    },
    (a) =>
      run(async () => {
        const sent = await sendMessage(d.actions, { chatId: a.chat_id, text: a.text, replyTo: a.reply_to });
        return formatMessage(toMessageRow(sent, true));
      }),
  );

  server.registerTool(
    'save_draft',
    {
      description: "Put a draft into the chat's input box in Telegram, so the user can review and send it from their phone.",
      inputSchema: { chat_id: z.number().int(), text },
      annotations: TELEGRAM_WRITE,
    },
    (a) => run(() => saveDraft(d.actions, { chatId: a.chat_id, text: a.text })),
  );

  server.registerTool(
    'mark_read',
    { description: 'Mark a chat as read in Telegram.', inputSchema: { chat_id: z.number().int() }, annotations: TELEGRAM_WRITE },
    (a) => run(() => markRead(d.actions, { chatId: a.chat_id })),
  );
}
