import { AppError } from '../domain/errors.js';
import type { DeleteMode } from '../telegram/types.js';
import { acquire, type ActionDeps, audited, requireChat } from './context.js';

const isBroadcastLike = (type: string): boolean => type === 'channel' || type === 'supergroup';

export async function deleteChat(d: ActionDeps, input: { chatId: number; mode: DeleteMode; confirmTitle?: string }): Promise<void> {
  const chat = requireChat(d, input.chatId);
  if (isBroadcastLike(chat.type)) {
    throw new AppError('VALIDATION', 'delete_chat covers private chats and basic groups; use leave_chat for channels and supergroups');
  }
  // revoke deletes the conversation for the other side too, so it needs a
  // deliberate, exact confirmation rather than a flag Claude could set casually.
  if (input.mode === 'revoke' && input.confirmTitle !== chat.title) {
    throw new AppError('VALIDATION', 'revoke deletes for everyone: confirm_title must exactly match the chat title');
  }
  acquire(d.limits.destructive.tryAcquire());
  await audited(d, `delete_chat:${input.mode}`, chat.id, () => d.gateway.deleteChat(chat.id, input.mode));
  if (input.mode === 'clear') {
    d.messages.softDeleteAll(chat.id, d.now());
    d.chats.setTop(chat.id, 0, false, 0, d.now());
  } else {
    d.chats.purge(chat.id);
  }
}

export async function leaveChat(d: ActionDeps, input: { chatId: number }): Promise<void> {
  const chat = requireChat(d, input.chatId);
  if (chat.type === 'user' || chat.type === 'bot') {
    throw new AppError('VALIDATION', 'leave_chat is for groups and channels; use delete_chat for private chats');
  }
  acquire(d.limits.destructive.tryAcquire());
  await audited(d, 'leave_chat', chat.id, () => d.gateway.leaveChat(chat.id));
  d.chats.purge(chat.id);
}

export async function blockUser(d: ActionDeps, input: { userId: number }): Promise<void> {
  acquire(d.limits.destructive.tryAcquire());
  await audited(d, 'block_user', input.userId, () => d.gateway.blockUser(input.userId));
}
