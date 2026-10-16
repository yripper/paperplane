import { type IAuthKeysRepository, type ITelegramStorageProvider, SqliteStorage, TelegramClient } from '@mtcute/node';

export interface ClientOptions {
  apiId: number;
  apiHash: string;
  mtcuteDbPath: string;
  authKeys: IAuthKeysRepository;
  log: (level: number, tag: string, fmt: string) => void;
}

const LOG_WARN = 2; // LogManager.WARN

export function createTelegramClient(o: ClientOptions): TelegramClient {
  const sqlite = new SqliteStorage(o.mtcuteDbPath);
  // mtcute's storage managers only read these five fields, so the auth key
  // can live in Keychain while peers and update state stay in SQLite.
  const storage: ITelegramStorageProvider = {
    driver: sqlite.driver,
    kv: sqlite.kv,
    peers: sqlite.peers,
    refMessages: sqlite.refMessages,
    authKeys: o.authKeys,
  };
  const tg = new TelegramClient({ apiId: o.apiId, apiHash: o.apiHash, storage, updates: { catchUp: true }, logLevel: LOG_WARN });
  // The format args can carry message payloads; only the tag and format string leave mtcute.
  tg.log.mgr.handler = (_color: number, level: number, tag: string, fmt: string) => o.log(level, tag, fmt);
  return tg;
}
