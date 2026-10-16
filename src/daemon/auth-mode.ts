export type AuthMode = 'connect' | 'ok' | 'auth_required';

/// Decides how the daemon runs without calling Telegram itself, so the
/// crash-loop-prone cases (not logged in yet, or after logout) stay testable.
/// `connect` is null until a connection has been attempted; 'connect' means
/// credentials are present and the caller should now try session.connect().
export function decideAuthMode(i: { hasApiId: boolean; hasApiHash: boolean; connect: 'ok' | 'auth_required' | null }): AuthMode {
  if (!i.hasApiId || !i.hasApiHash) return 'auth_required';
  if (i.connect === null) return 'connect';
  return i.connect;
}
