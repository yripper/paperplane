import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { beforeEach, describe, expect, it } from 'vitest';
import { AppError } from '../domain/errors.js';
import { connect, makeToolDeps } from '../testing/tool-deps.js';
import { tgMessage } from '../testing/fixtures.js';

let client: Client;
let t: ReturnType<typeof makeToolDeps>['t'];

const call = async (name: string, args: Record<string, unknown> = {}): Promise<{ isError: boolean; text: string }> => {
  const res = await client.callTool({ name, arguments: args });
  const content = res.content as { type: string; text: string }[];
  return { isError: res.isError === true, text: content[0]?.text ?? '' };
};

beforeEach(async () => {
  const made = makeToolDeps();
  t = made.t;
  client = await connect(made.deps);
  t.deps.sink.onMessage(tgMessage({ id: 1, text: 'can you send the invoice?' }), { live: true });
});

describe('MCP tools', () => {
  it('exposes every tool with safety annotations', async () => {
    const { tools } = await client.listTools();
    const byName = new Map(tools.map((tool) => [tool.name, tool]));
    expect([...byName.keys()].sort()).toEqual(
      [
        'archive_chats', 'block_user', 'clear_label', 'cleanup_apply', 'cleanup_plan', 'create_folder', 'delete_chat',
        'delete_folder', 'edit_folder', 'get_chat_info', 'get_pending', 'leave_chat', 'list_chats', 'list_folders',
        'mark_read', 'mute_chat', 'read_history', 'save_draft', 'search_messages', 'send_message', 'set_label',
        'set_watch_level', 'status', 'unarchive_chats', 'unmute_chat',
      ].sort(),
    );
    for (const name of ['delete_chat', 'leave_chat', 'block_user', 'cleanup_apply']) {
      expect(byName.get(name)?.annotations?.destructiveHint).toBe(true);
    }
    for (const name of ['status', 'list_chats', 'get_pending', 'read_history', 'search_messages', 'get_chat_info']) {
      expect(byName.get(name)?.annotations?.readOnlyHint).toBe(true);
    }
  });

  it('get_pending returns chats waiting on me', async () => {
    const res = await call('get_pending');
    expect(res.isError).toBe(false);
    expect(JSON.parse(res.text)).toMatchObject([{ id: 10, status: 'pending', title: 'Alice Example' }]);
  });

  it('read_history and search_messages read the mirror', async () => {
    expect(JSON.parse((await call('read_history', { chat_id: 10 })).text)[0]).toMatchObject({ id: 1, from: 10 });
    expect(JSON.parse((await call('search_messages', { query: 'invoice' })).text)).toHaveLength(1);
  });

  it('send_message sends through the gateway and clears pending', async () => {
    const res = await call('send_message', { chat_id: 10, text: 'sending now' });
    expect(JSON.parse(res.text)).toMatchObject({ from: 'me', text: 'sending now', viaPaperplane: true });
    expect(JSON.parse((await call('get_pending')).text)).toEqual([]);
  });

  it('rejects invalid input', async () => {
    const res = await call('send_message', { chat_id: 10, text: '' });
    expect(res.isError).toBe(true);
    expect(t.gateway.callsTo('sendText')).toHaveLength(0);
  });

  it('refuses revoke without confirmation and reports VALIDATION', async () => {
    const res = await call('delete_chat', { chat_id: 10, mode: 'revoke' });
    expect(res).toMatchObject({ isError: true });
    expect(res.text.startsWith('VALIDATION:')).toBe(true);
    expect(t.gateway.callsTo('deleteChat')).toHaveLength(0);
  });

  it('returns AUTH_REQUIRED from write tools when the gateway is unauthenticated', async () => {
    t.gateway.failOn.set('sendText', new AppError('AUTH_REQUIRED', 'not logged in: run `paperplane login`'));
    const res = await call('send_message', { chat_id: 10, text: 'hello' });
    expect(res.isError).toBe(true);
    expect(res.text.startsWith('AUTH_REQUIRED:')).toBe(true);
  });

  it('set_label requires snooze_until for snoozes and hides done chats', async () => {
    expect((await call('set_label', { chat_id: 10, label: 'snoozed' })).text.startsWith('VALIDATION:')).toBe(true);
    await call('set_label', { chat_id: 10, label: 'done', note: 'answered by phone' });
    expect(JSON.parse((await call('get_pending')).text)).toEqual([]);
  });

  it('cleanup_plan then cleanup_apply', async () => {
    const plan = JSON.parse((await call('cleanup_plan', { inactive_days: 1 })).text) as { planId: string; count: number };
    expect(plan.count).toBe(1);
    const report = JSON.parse((await call('cleanup_apply', { plan_id: plan.planId })).text);
    expect(report).toEqual({ done: [10], failed: [], skipped: [] });
  });

  it('cleanup_plan rejects criteria that narrow nothing', async () => {
    const res = await call('cleanup_plan', { muted_only: false });
    expect(res.isError).toBe(true);
    expect(res.text.startsWith('VALIDATION:')).toBe(true);
  });
});
