import { AppError } from '../domain/errors.js';
import type { UpdateSink } from '../sync/update-sink.js';
import { adaptMessage } from './adapt.js';
import { type ClientOptions, createTelegramClient } from './client.js';
import { mapTelegramError } from './errors.js';
import { MtcuteGateway } from './gateway.js';
import type { TelegramGateway } from './types.js';

export interface SessionHooks {
  onUpdate: () => void;
  onUpdateError: (what: string, e: unknown) => void;
  onClientError: (e: unknown) => void;
}

export interface Session {
  gateway: TelegramGateway;
  connect(): Promise<'ok' | 'auth_required'>;
  destroy(): Promise<void>;
}

export interface LoginPrompts {
  phone: () => Promise<string>;
  code: () => Promise<string>;
  password: () => Promise<string>;
}

/// The daemon's single connection. Update handlers never throw into mtcute:
/// one bad update must not stop the stream.
export function createSession(o: ClientOptions, sink: UpdateSink, hooks: SessionHooks): Session {
  const tg = createTelegramClient(o);
  const apply = (what: string, fn: () => void): void => {
    try {
      fn();
      hooks.onUpdate();
    } catch (e) {
      hooks.onUpdateError(what, e);
    }
  };
  tg.onNewMessage.add((m) => apply('new_message', () => sink.onMessage(adaptMessage(m), { live: true })));
  tg.onEditMessage.add((m) => apply('edit_message', () => sink.onEdit(adaptMessage(m))));
  tg.onDeleteMessage.add((u) => apply('delete_message', () => sink.onDelete({ channelId: u.channelId, messageIds: u.messageIds })));
  tg.onHistoryRead.add((u) =>
    apply('history_read', () => sink.onRead({ chatId: u.chatId, maxReadId: u.maxReadId, isOutbox: u.isOutbox, unreadCount: u.unreadCount })),
  );
  tg.onError.add((e) => hooks.onClientError(e));

  return {
    gateway: new MtcuteGateway(tg),
    async connect() {
      // The daemon never prompts: if mtcute asks for a phone, we're not logged in.
      const refuse = (): never => {
        throw new AppError('AUTH_REQUIRED', 'not logged in: run `paperplane login`');
      };
      try {
        await tg.start({ phone: refuse, code: refuse, password: refuse });
        return 'ok';
      } catch (e) {
        const err = mapTelegramError(e);
        if (err.code === 'AUTH_REQUIRED') return 'auth_required';
        throw err;
      }
    },
    destroy: () => tg.destroy(),
  };
}

export async function login(o: ClientOptions, prompts: LoginPrompts): Promise<string> {
  const tg = createTelegramClient(o);
  try {
    const me = await tg.start({ phone: prompts.phone, code: prompts.code, password: prompts.password, codeSentCallback: () => {} });
    return me.displayName;
  } finally {
    await tg.destroy();
  }
}

export async function logout(o: ClientOptions): Promise<void> {
  const tg = createTelegramClient(o);
  try {
    await tg.logOut();
  } finally {
    await tg.destroy();
  }
}
