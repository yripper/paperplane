import { beforeEach, describe, expect, it } from 'vitest';
import { makeActionDeps } from '../testing/action-deps.js';
import { archiveChats, createFolder, editFolder, setChatMuted, unarchiveChats } from './organize.js';

let t: ReturnType<typeof makeActionDeps>;

beforeEach(() => {
  t = makeActionDeps();
  t.store.chats.ensure({ id: 10, type: 'user', title: 'Alice Example', username: null }, 'normal', 0);
});

describe('organize', () => {
  it('creates and edits folders through the gateway', async () => {
    const folder = await createFolder(t.deps, { title: 'Work', chatIds: [10] });
    const edited = await editFolder(t.deps, { folderId: folder.id, addChatIds: [11], removeChatIds: [10] });
    expect(edited.includeChatIds).toEqual([11]);
  });

  it('archives and unarchives on Telegram and locally', async () => {
    await archiveChats(t.deps, { chatIds: [10] });
    expect(t.store.chats.get(10)?.archived).toBe(true);
    await unarchiveChats(t.deps, { chatIds: [10] });
    expect(t.store.chats.get(10)?.archived).toBe(false);
  });

  it('mutes on Telegram and records the flag', async () => {
    await setChatMuted(t.deps, { chatId: 10, muted: true });
    expect(t.gateway.callsTo('setMuted')).toEqual([[10, true]]);
    expect(t.store.chats.get(10)?.muted).toBe(true);
  });
});
