import type { TgFolder } from '../telegram/types.js';
import { type ActionDeps, audited, requireChat } from './context.js';

export function listFolders(d: ActionDeps): Promise<TgFolder[]> {
  return d.gateway.getFolders();
}

export function createFolder(d: ActionDeps, input: { title: string; chatIds: number[] }): Promise<TgFolder> {
  return audited(d, 'create_folder', null, () => d.gateway.createFolder(input));
}

export function editFolder(
  d: ActionDeps,
  input: { folderId: number; title?: string; addChatIds?: number[]; removeChatIds?: number[] },
): Promise<TgFolder> {
  const { folderId, ...change } = input;
  return audited(d, 'edit_folder', null, () => d.gateway.editFolder(folderId, change));
}

export function deleteFolder(d: ActionDeps, input: { folderId: number }): Promise<void> {
  return audited(d, 'delete_folder', null, () => d.gateway.deleteFolder(input.folderId));
}

export async function archiveChats(d: ActionDeps, input: { chatIds: number[] }): Promise<void> {
  await audited(d, 'archive_chats', null, () => d.gateway.archive(input.chatIds));
  d.chats.setArchived(input.chatIds, true, d.now());
}

export async function unarchiveChats(d: ActionDeps, input: { chatIds: number[] }): Promise<void> {
  await audited(d, 'unarchive_chats', null, () => d.gateway.unarchive(input.chatIds));
  d.chats.setArchived(input.chatIds, false, d.now());
}

export async function setChatMuted(d: ActionDeps, input: { chatId: number; muted: boolean }): Promise<void> {
  requireChat(d, input.chatId);
  await audited(d, input.muted ? 'mute_chat' : 'unmute_chat', input.chatId, () => d.gateway.setMuted(input.chatId, input.muted));
  d.chats.setMuted(input.chatId, input.muted, d.now());
}
