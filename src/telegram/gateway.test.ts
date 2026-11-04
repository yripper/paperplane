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

describe('MtcuteGateway.getUsers', () => {
  // Users mtcute can't resolve (not in its peer cache) make the whole batch throw.
  const fakeUsers = (known: Record<number, { displayName: string; username: string | null }>) => {
    const batches: number[][] = [];
    const client = {
      getUsers: async (ids: number | number[]) => {
        const list = Array.isArray(ids) ? ids : [ids];
        batches.push(list);
        if (list.some((id) => !(id in known))) throw new Error('PEER_ID_INVALID');
        return list.map((id) => ({ id, type: 'user', isBot: false, ...known[id] }));
      },
    };
    return { gateway: new MtcuteGateway(client as unknown as TelegramClient), batches };
  };

  it('fetches users in one batch', async () => {
    const f = fakeUsers({ 21: { displayName: 'Carol Example', username: 'carol_example' } });
    expect(await f.gateway.getUsers([21])).toEqual([{ id: 21, name: 'Carol Example', username: 'carol_example', isBot: false }]);
    expect(f.batches).toEqual([[21]]);
  });

  it('falls back to one at a time and drops users it cannot resolve', async () => {
    const f = fakeUsers({ 21: { displayName: 'Carol Example', username: null } });
    expect(await f.gateway.getUsers([21, 99])).toEqual([{ id: 21, name: 'Carol Example', username: null, isBot: false }]);
    expect(f.batches).toEqual([[21, 99], [21], [99]]);
  });

  it('makes no call for an empty list', async () => {
    const f = fakeUsers({});
    expect(await f.gateway.getUsers([])).toEqual([]);
    expect(f.batches).toEqual([]);
  });
});

describe('MtcuteGateway.deleteGroup', () => {
  const fakeDeletes = (peer: tl.TypeInputPeer) => {
    const calls: string[] = [];
    const client = {
      resolvePeer: async () => peer,
      deleteGroup: async () => void calls.push('deleteGroup'),
      deleteChannel: async () => void calls.push('deleteChannel'),
    };
    return { gateway: new MtcuteGateway(client as unknown as TelegramClient), calls };
  };

  it('deletes a basic group with deleteGroup', async () => {
    const f = fakeDeletes({ _: 'inputPeerChat', chatId: 42 });
    await f.gateway.deleteGroup(-42);
    expect(f.calls).toEqual(['deleteGroup']);
  });

  it('deletes supergroups and channels with deleteChannel', async () => {
    const f = fakeDeletes({ _: 'inputPeerChannel', channelId: 7, accessHash: Long.ZERO });
    await f.gateway.deleteGroup(-1000000000007);
    expect(f.calls).toEqual(['deleteChannel']);
  });

  it('refuses users', async () => {
    const f = fakeDeletes({ _: 'inputPeerUser', userId: 5, accessHash: Long.ZERO });
    await expect(f.gateway.deleteGroup(5)).rejects.toMatchObject({ code: 'VALIDATION' });
    expect(f.calls).toEqual([]);
  });

  it('maps CHAT_ADMIN_REQUIRED (not the owner) to FORBIDDEN', async () => {
    const client = {
      resolvePeer: async () => ({ _: 'inputPeerChat', chatId: 42 }),
      deleteGroup: async () => {
        throw new tl.RpcError(400, 'CHAT_ADMIN_REQUIRED');
      },
    };
    const gateway = new MtcuteGateway(client as unknown as TelegramClient);
    await expect(gateway.deleteGroup(-42)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('MtcuteGateway.downloadMedia', () => {
  const fakeMedia = (message: unknown) => {
    const downloads: unknown[] = [];
    const client = {
      getMessages: async () => [message],
      downloadAsBuffer: async (loc: unknown) => {
        downloads.push(loc);
        return new Uint8Array([1, 2, 3]);
      },
    };
    return { gateway: new MtcuteGateway(client as unknown as TelegramClient), downloads };
  };

  it('downloads a voice note with its mime type', async () => {
    const voice = { type: 'voice', mimeType: 'audio/ogg', fileName: null, fileSize: 3 };
    const f = fakeMedia({ media: voice });
    expect(await f.gateway.downloadMedia(10, 5, 100)).toEqual({ kind: 'voice', mimeType: 'audio/ogg', fileName: null, bytes: new Uint8Array([1, 2, 3]) });
    expect(f.downloads).toEqual([voice]);
  });

  it('reports photos as image/jpeg', async () => {
    const f = fakeMedia({ media: { type: 'photo', fileSize: 3 } });
    expect(await f.gateway.downloadMedia(10, 5, 100)).toMatchObject({ kind: 'photo', mimeType: 'image/jpeg', fileName: null });
  });

  it('returns NOT_FOUND for a missing message or a text-only message', async () => {
    await expect(fakeMedia(null).gateway.downloadMedia(10, 5, 100)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(fakeMedia({ media: null }).gateway.downloadMedia(10, 5, 100)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('refuses media without a file (poll, location)', async () => {
    const f = fakeMedia({ media: { type: 'poll' } });
    await expect(f.gateway.downloadMedia(10, 5, 100)).rejects.toMatchObject({ code: 'VALIDATION' });
    expect(f.downloads).toEqual([]);
  });

  it('refuses files above the size cap before downloading', async () => {
    const f = fakeMedia({ media: { type: 'video', mimeType: 'video/mp4', fileName: null, fileSize: 101 } });
    await expect(f.gateway.downloadMedia(10, 5, 100)).rejects.toMatchObject({ code: 'VALIDATION' });
    expect(f.downloads).toEqual([]);
  });
});
