import { Long, type TelegramClient, tl } from '@mtcute/node';
import { describe, expect, it } from 'vitest';
import { DELETE_HISTORY_MAX_CALLS, MtcuteGateway } from './gateway.js';

/// Just the client surface deleteChat touches; everything else would throw.
function fakeClient(offsets: number[], peer: tl.TypeInputPeer = { _: 'inputPeerUser', userId: 5, accessHash: Long.ZERO }) {
  const calls: tl.messages.RawDeleteHistoryRequest[] = [];
  const updates: tl.TypeUpdates[] = [];
  let i = 0;
  const client = {
    resolvePeer: async () => peer,
    call: async (req: tl.messages.RawDeleteHistoryRequest): Promise<tl.messages.RawAffectedHistory> => {
      calls.push(req);
      const offset = offsets[Math.min(i, offsets.length - 1)] ?? 0;
      i++;
      return { _: 'messages.affectedHistory', pts: 100 + i, ptsCount: 1, offset };
    },
    handleClientUpdate: (u: tl.TypeUpdates) => {
      updates.push(u);
    },
  };
  return { gateway: new MtcuteGateway(client as unknown as TelegramClient), calls, updates };
}

describe('MtcuteGateway.deleteChat', () => {
  it('repeats messages.deleteHistory while Telegram reports a positive offset', async () => {
    const f = fakeClient([7, 3, 0]);
    await f.gateway.deleteChat(5, 'delete');
    expect(f.calls).toHaveLength(3);
    for (const c of f.calls) expect(c).toMatchObject({ _: 'messages.deleteHistory', maxId: 0, justClear: false, revoke: false });
  });

  it('maps clear to justClear and revoke to revoke', async () => {
    const clear = fakeClient([0]);
    await clear.gateway.deleteChat(5, 'clear');
    expect(clear.calls[0]).toMatchObject({ justClear: true, revoke: false });
    const revoke = fakeClient([0]);
    await revoke.gateway.deleteChat(5, 'revoke');
    expect(revoke.calls[0]).toMatchObject({ justClear: false, revoke: true });
  });

  it('feeds each call\'s pts to the update loop, like mtcute\'s deleteHistory', async () => {
    const f = fakeClient([2, 0]);
    await f.gateway.deleteChat(5, 'delete');
    expect(f.updates).toEqual([
      { _: 'updates', seq: 0, date: 0, chats: [], users: [], updates: [{ _: 'mtcute.dummyUpdate', channelId: 0, pts: 101, ptsCount: 1 }] },
      { _: 'updates', seq: 0, date: 0, chats: [], users: [], updates: [{ _: 'mtcute.dummyUpdate', channelId: 0, pts: 102, ptsCount: 1 }] },
    ]);
  });

  it('uses the channel id for channel peers', async () => {
    const f = fakeClient([0], { _: 'inputPeerChannel', channelId: 42, accessHash: Long.ZERO });
    await f.gateway.deleteChat(-10042, 'delete');
    expect(f.updates[0]).toMatchObject({ updates: [{ channelId: 42 }] });
  });

  it('throws INTERNAL after the safety cap instead of looping forever', async () => {
    const f = fakeClient([1]);
    await expect(f.gateway.deleteChat(5, 'delete')).rejects.toMatchObject({ code: 'INTERNAL' });
    expect(f.calls).toHaveLength(DELETE_HISTORY_MAX_CALLS);
  });

  it('maps Telegram errors', async () => {
    const f = fakeClient([0]);
    (f.gateway as unknown as { tg: { call: () => Promise<never> } }).tg.call = () => Promise.reject(tl.RpcError.fromTl({ errorCode: 403, errorMessage: 'CHAT_ADMIN_REQUIRED' }));
    await expect(f.gateway.deleteChat(5, 'delete')).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
