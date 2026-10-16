/// Append-only: each entry upgrades user_version N → N+1. Never edit a
/// shipped migration; add a new one.
export const MIGRATIONS: readonly string[] = [
  `
  CREATE TABLE chats (
    id INTEGER PRIMARY KEY,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    username TEXT,
    watch_level TEXT NOT NULL,
    archived INTEGER NOT NULL DEFAULT 0,
    muted INTEGER NOT NULL DEFAULT 0,
    top_msg_id INTEGER NOT NULL DEFAULT 0,
    top_msg_out INTEGER NOT NULL DEFAULT 0,
    top_msg_date INTEGER NOT NULL DEFAULT 0,
    unread_count INTEGER NOT NULL DEFAULT 0,
    read_inbox_max_id INTEGER NOT NULL DEFAULT 0,
    read_outbox_max_id INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL DEFAULT 0
  );

  -- Surrogate id because FTS5 external content needs an integer rowid.
  CREATE TABLE messages (
    id INTEGER PRIMARY KEY,
    chat_id INTEGER NOT NULL,
    msg_id INTEGER NOT NULL,
    sender_id INTEGER,
    date INTEGER NOT NULL,
    out INTEGER NOT NULL,
    text TEXT NOT NULL DEFAULT '',
    media_kind TEXT,
    reply_to_msg_id INTEGER,
    edited_at INTEGER,
    deleted_at INTEGER,
    sent_via_paperplane INTEGER NOT NULL DEFAULT 0,
    UNIQUE (chat_id, msg_id)
  );
  CREATE INDEX messages_chat_out ON messages (chat_id, out, msg_id);

  CREATE VIRTUAL TABLE messages_fts USING fts5(text, content='messages', content_rowid='id');
  CREATE TRIGGER messages_ai AFTER INSERT ON messages BEGIN
    INSERT INTO messages_fts (rowid, text) VALUES (new.id, new.text);
  END;
  CREATE TRIGGER messages_ad AFTER DELETE ON messages BEGIN
    INSERT INTO messages_fts (messages_fts, rowid, text) VALUES ('delete', old.id, old.text);
  END;
  CREATE TRIGGER messages_au AFTER UPDATE OF text ON messages BEGIN
    INSERT INTO messages_fts (messages_fts, rowid, text) VALUES ('delete', old.id, old.text);
    INSERT INTO messages_fts (rowid, text) VALUES (new.id, new.text);
  END;

  CREATE TABLE chat_labels (
    chat_id INTEGER PRIMARY KEY,
    label TEXT NOT NULL,
    snooze_until INTEGER,
    note TEXT,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE sync_cursors (
    chat_id INTEGER PRIMARY KEY,
    oldest_synced_msg_id INTEGER,
    backfill_complete INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE cleanup_plans (
    id TEXT PRIMARY KEY,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    mode TEXT NOT NULL,
    criteria_json TEXT NOT NULL,
    items_json TEXT NOT NULL,
    status TEXT NOT NULL
  );

  -- Metadata only: never message text or secrets.
  CREATE TABLE audit_log (
    id INTEGER PRIMARY KEY,
    ts INTEGER NOT NULL,
    action TEXT NOT NULL,
    chat_id INTEGER,
    outcome TEXT NOT NULL
  );
  `,
  `
  -- Who wrote messages, so transcripts show names and @usernames instead of ids.
  -- Users, plus chats that post as themselves (negative ids).
  CREATE TABLE senders (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    username TEXT,
    is_bot INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL
  );
  `,
];
