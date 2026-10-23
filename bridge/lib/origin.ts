/**
 * The WebSocket Origin allow-list shared by the fake live backend and the
 * Claude Code bridge. Browsers always send Origin on a WebSocket handshake;
 * clients that send none (CLI tools, tests) are allowed. A browser page is
 * allowed only when it is served from localhost or 127.0.0.1, on any port.
 */

const ALLOWED_ORIGIN_HOSTS: ReadonlySet<string> = new Set([
  "localhost",
  "127.0.0.1",
]);

export function isAllowedOrigin(origin: string | undefined): boolean {
  if (origin === undefined) return true;
  try {
    return ALLOWED_ORIGIN_HOSTS.has(new URL(origin).hostname);
  } catch {
    return false;
  }
}
