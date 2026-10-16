import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { archiveChats, createFolder, deleteFolder, editFolder, listFolders, setChatMuted, unarchiveChats } from '../../actions/organize.js';
import { run } from '../result.js';
import type { ToolDeps } from '../server.js';
import { READ, TELEGRAM_WRITE } from './annotations.js';

const chatIds = z.array(z.number().int()).min(1).max(100);

export function registerOrganizeTools(server: McpServer, d: ToolDeps): void {
  server.registerTool(
    'list_folders',
    { description: 'Telegram chat folders with the chat ids they include.', inputSchema: {}, annotations: { ...READ, openWorldHint: true } },
    () => run(() => listFolders(d.actions)),
  );

  server.registerTool(
    'create_folder',
    { description: 'Create a Telegram folder containing the given chats.', inputSchema: { title: z.string().min(1).max(64), chat_ids: chatIds }, annotations: TELEGRAM_WRITE },
    (a) => run(() => createFolder(d.actions, { title: a.title, chatIds: a.chat_ids })),
  );

  server.registerTool(
    'edit_folder',
    {
      description: 'Rename a folder and/or add or remove chats.',
      inputSchema: {
        folder_id: z.number().int(),
        title: z.string().min(1).max(64).optional(),
        add_chat_ids: z.array(z.number().int()).max(100).optional(),
        remove_chat_ids: z.array(z.number().int()).max(100).optional(),
      },
      annotations: TELEGRAM_WRITE,
    },
    (a) =>
      run(() =>
        editFolder(d.actions, { folderId: a.folder_id, title: a.title, addChatIds: a.add_chat_ids, removeChatIds: a.remove_chat_ids }),
      ),
  );

  server.registerTool(
    'delete_folder',
    { description: 'Delete a folder (the chats stay).', inputSchema: { folder_id: z.number().int() }, annotations: TELEGRAM_WRITE },
    (a) => run(() => deleteFolder(d.actions, { folderId: a.folder_id })),
  );

  server.registerTool(
    'archive_chats',
    { description: 'Move chats to the Telegram archive.', inputSchema: { chat_ids: chatIds }, annotations: TELEGRAM_WRITE },
    (a) => run(() => archiveChats(d.actions, { chatIds: a.chat_ids })),
  );

  server.registerTool(
    'unarchive_chats',
    { description: 'Move chats out of the archive.', inputSchema: { chat_ids: chatIds }, annotations: TELEGRAM_WRITE },
    (a) => run(() => unarchiveChats(d.actions, { chatIds: a.chat_ids })),
  );

  server.registerTool(
    'mute_chat',
    { description: 'Mute notifications for a chat in Telegram (forever).', inputSchema: { chat_id: z.number().int() }, annotations: TELEGRAM_WRITE },
    (a) => run(() => setChatMuted(d.actions, { chatId: a.chat_id, muted: true })),
  );

  server.registerTool(
    'unmute_chat',
    { description: 'Unmute notifications for a chat in Telegram.', inputSchema: { chat_id: z.number().int() }, annotations: TELEGRAM_WRITE },
    (a) => run(() => setChatMuted(d.actions, { chatId: a.chat_id, muted: false })),
  );
}
