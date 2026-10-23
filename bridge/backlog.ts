/** WebSocket write backpressure: a client that cannot keep up is dropped. */
import type { Socket } from "node:net";

export const MAX_CLIENT_BACKLOG_BYTES = 1024 * 1024;

export function isBackedUp(socket: Socket): boolean {
  return socket.writableLength > MAX_CLIENT_BACKLOG_BYTES;
}
