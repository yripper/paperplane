import { describe, expect, it } from 'vitest';
import { createUnauthenticatedGateway, NOT_CONNECTED } from './unauthenticated-gateway.js';

describe('createUnauthenticatedGateway', () => {
  const g = createUnauthenticatedGateway();
  const calls: Record<string, () => Promise<unknown>> = {
    getHistory: () => g.getHistory(1, { limit: 1 }),
    search: () => g.search({ query: 'q', limit: 1 }),
    sendText: () => g.sendText(1, 't'),
    saveDraft: () => g.saveDraft(1, 't'),
    markRead: () => g.markRead(1),
    getFolders: () => g.getFolders(),
    createFolder: () => g.createFolder({ title: 'f', chatIds: [] }),
    editFolder: () => g.editFolder(1, {}),
    deleteFolder: () => g.deleteFolder(1),
    archive: () => g.archive([1]),
    unarchive: () => g.unarchive([1]),
    setMuted: () => g.setMuted(1, true),
    deleteChat: () => g.deleteChat(1, 'delete'),
    leaveChat: () => g.leaveChat(1),
    blockUser: () => g.blockUser(1),
    getUsers: () => g.getUsers([1]),
  };

  it.each(Object.entries(calls))('%s rejects with AUTH_REQUIRED', async (_name, call) => {
    await expect(call()).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
  });

  it('iterDialogs throws AUTH_REQUIRED on first iteration', async () => {
    const it2 = g.iterDialogs()[Symbol.asyncIterator]();
    await expect(it2.next()).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
  });

  it('covers every gateway method', () => {
    expect(Object.keys(g).sort()).toEqual([...Object.keys(calls), 'iterDialogs'].sort());
  });

  it('tells the user to stop pm2 around login, since login takes the daemon lock', async () => {
    await expect(g.markRead(1)).rejects.toThrow('pm2 stop paperplane && paperplane login && pm2 start paperplane');
  });

  it('uses the given message while connecting', async () => {
    await expect(createUnauthenticatedGateway(NOT_CONNECTED).markRead(1)).rejects.toMatchObject({ code: 'AUTH_REQUIRED', message: NOT_CONNECTED });
  });
});
