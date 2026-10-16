import type { TgMessage } from '../telegram/types.js';
import { acquire, type ActionDeps, audited, requireChat } from './context.js';

export async function sendMessage(d: ActionDeps, input: { chatId: number; text: string; replyTo?: number }): Promise<TgMessage> {
  requireChat(d, input.chatId);
  acquire(d.limits.chatGap.tryAcquire(input.chatId));
  acquire(d.limits.sends.tryAcquire());
  const sent = await audited(d, 'send_message', input.chatId, () => d.gateway.sendText(input.chatId, input.text, input.replyTo));
  // The message is already out, so a store failure must not look like a failed
  // send (that invites a duplicate); the sweep reconciles it later. Storing it
  // right away lets get_pending reflect the reply before the live update.
  // Muted chats store no row: the sink skips them.
  try {
    d.sink.onMessage(sent, { live: true, sentViaPaperplane: true });
  } catch {
    d.audit.record('send_message.store', input.chatId, 'error', d.now());
  }
  return sent;
}

export async function saveDraft(d: ActionDeps, input: { chatId: number; text: string }): Promise<void> {
  requireChat(d, input.chatId);
  await audited(d, 'save_draft', input.chatId, () => d.gateway.saveDraft(input.chatId, input.text));
}

export async function markRead(d: ActionDeps, input: { chatId: number }): Promise<void> {
  const chat = requireChat(d, input.chatId);
  await audited(d, 'mark_read', chat.id, () => d.gateway.markRead(chat.id));
  d.chats.setReadInbox(chat.id, chat.topMsgId, 0, d.now());
}
