import type { TgMessage } from '../telegram/types.js';
import { acquire, type ActionDeps, audited, requireChat } from './context.js';

export async function sendMessage(d: ActionDeps, input: { chatId: number; text: string; replyTo?: number }): Promise<TgMessage> {
  requireChat(d, input.chatId);
  acquire(d.limits.chatGap.tryAcquire(input.chatId));
  acquire(d.limits.sends.tryAcquire());
  return audited(d, 'send_message', input.chatId, async () => {
    const sent = await d.gateway.sendText(input.chatId, input.text, input.replyTo);
    // Store what Telegram returned right away, so get_pending reflects the
    // reply even before the live update for it arrives.
    d.sink.onMessage(sent, { live: true, sentViaPaperplane: true });
    return sent;
  });
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
