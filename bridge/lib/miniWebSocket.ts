/**
 * The smallest useful server side of RFC 6455: the handshake accept value,
 * masked client frames and close frames. The repo deliberately installs no
 * `ws` package, so the fake live backend and the Claude Code bridge share this
 * instead of a dependency.
 *
 * Protocol violations never stall the parser. `readFrames` reports the first
 * violation as a `WebSocketProtocolError` that carries the close code the
 * server must send before dropping the connection.
 */
import { createHash } from "node:crypto";

export const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
export const OPCODE_CONTINUATION = 0x0;
export const OPCODE_TEXT = 0x1;
export const OPCODE_BINARY = 0x2;
export const OPCODE_CLOSE = 0x8;
export const OPCODE_PING = 0x9;
export const OPCODE_PONG = 0xa;

export const CLOSE_NORMAL = 1000;
export const CLOSE_PROTOCOL_ERROR = 1002;
export const CLOSE_MESSAGE_TOO_BIG = 1009;

/** Largest client frame payload accepted. Bigger declared lengths are refused before buffering. */
export const MAX_FRAME_PAYLOAD_BYTES = 1024 * 1024;

const FIN_BIT = 0x80;
const RSV_BITS = 0x70;
const OPCODE_MASK = 0x0f;
const CONTROL_OPCODE_BIT = 0x08;
const MASK_BIT = 0x80;
const LENGTH_MASK = 0x7f;
const LENGTH_16_BIT_MARKER = 126;
const LENGTH_64_BIT_MARKER = 127;
const MAX_CONTROL_PAYLOAD_BYTES = 125;
const MASK_BYTES = 4;
const KNOWN_OPCODES: ReadonlySet<number> = new Set([
  OPCODE_CONTINUATION,
  OPCODE_TEXT,
  OPCODE_BINARY,
  OPCODE_CLOSE,
  OPCODE_PING,
  OPCODE_PONG,
]);

export interface ClientFrame {
  opcode: number;
  text: string;
}

/** A violation of RFC 6455 by the peer. `closeCode` is the status to send back. */
export class WebSocketProtocolError extends Error {
  readonly closeCode: number;

  constructor(closeCode: number, message: string) {
    super(message);
    this.name = "WebSocketProtocolError";
    this.closeCode = closeCode;
  }
}

export interface ReadFramesResult {
  frames: ClientFrame[];
  /** Bytes not yet consumed. Only a partial frame can remain, so it stays under the frame cap. */
  rest: Buffer;
  /** Set when the stream broke the protocol. Frames before the violation are still returned. */
  protocolError: WebSocketProtocolError | null;
}

interface ParsedFrame {
  opcode: number;
  payload: Buffer;
  end: number;
}

export function webSocketAccept(key: string): string {
  return createHash("sha1").update(key + WS_GUID).digest("base64");
}

export function encodeFrame(opcode: number, payload: Buffer): Buffer {
  const length = payload.length;
  let header: Buffer;
  if (length < 126) {
    header = Buffer.alloc(2);
    header[1] = length;
  } else if (length < 65536) {
    header = Buffer.alloc(4);
    header[1] = 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }
  header[0] = 0x80 | opcode;
  return Buffer.concat([header, payload]);
}

export function encodeText(value: string): Buffer {
  return encodeFrame(OPCODE_TEXT, Buffer.from(value, "utf8"));
}

export function encodeClose(closeCode: number): Buffer {
  const body = Buffer.alloc(2);
  body.writeUInt16BE(closeCode, 0);
  return encodeFrame(OPCODE_CLOSE, body);
}

function protocolError(closeCode: number, message: string): WebSocketProtocolError {
  return new WebSocketProtocolError(closeCode, message);
}

function oversizeError(): WebSocketProtocolError {
  return protocolError(
    CLOSE_MESSAGE_TOO_BIG,
    `frame payload exceeds ${MAX_FRAME_PAYLOAD_BYTES} bytes`,
  );
}

function checkFirstByte(first: number): number {
  if ((first & RSV_BITS) !== 0) {
    throw protocolError(CLOSE_PROTOCOL_ERROR, "reserved bits set without an extension");
  }
  const opcode = first & OPCODE_MASK;
  if (!KNOWN_OPCODES.has(opcode)) {
    throw protocolError(CLOSE_PROTOCOL_ERROR, `unknown opcode ${opcode}`);
  }
  // Fragmented messages (FIN clear, or a continuation frame) are rejected
  // rather than reassembled, so every message is a single frame.
  if ((first & FIN_BIT) === 0 || opcode === OPCODE_CONTINUATION) {
    throw protocolError(CLOSE_PROTOCOL_ERROR, "fragmented messages are not supported");
  }
  return opcode;
}

function readPayloadLength(
  buffer: Buffer,
  second: number,
  offset: number,
): { length: number; cursor: number } | null {
  const marker = second & LENGTH_MASK;
  if (marker === LENGTH_16_BIT_MARKER) {
    if (buffer.length - offset < 2) return null;
    return { length: buffer.readUInt16BE(offset), cursor: offset + 2 };
  }
  if (marker === LENGTH_64_BIT_MARKER) {
    if (buffer.length - offset < 8) return null;
    const declared = buffer.readBigUInt64BE(offset);
    if (declared > BigInt(MAX_FRAME_PAYLOAD_BYTES)) throw oversizeError();
    return { length: Number(declared), cursor: offset + 8 };
  }
  return { length: marker, cursor: offset };
}

/** Parses the frame starting at `offset`, or returns null when more bytes are needed. */
function parseFrame(buffer: Buffer, offset: number): ParsedFrame | null {
  if (buffer.length - offset < 2) return null;
  const first = buffer[offset];
  const second = buffer[offset + 1];
  const opcode = checkFirstByte(first);
  if ((second & MASK_BIT) === 0) {
    throw protocolError(CLOSE_PROTOCOL_ERROR, "client frames must be masked");
  }
  const header = readPayloadLength(buffer, second, offset + 2);
  if (header === null) return null;
  const { length, cursor } = header;
  if (length > MAX_FRAME_PAYLOAD_BYTES) throw oversizeError();
  const isControl = (opcode & CONTROL_OPCODE_BIT) !== 0;
  if (isControl && length > MAX_CONTROL_PAYLOAD_BYTES) {
    throw protocolError(CLOSE_PROTOCOL_ERROR, "control frame payload exceeds 125 bytes");
  }
  const payloadStart = cursor + MASK_BYTES;
  const end = payloadStart + length;
  if (buffer.length < end) return null;
  const mask = buffer.subarray(cursor, payloadStart);
  const payload = Buffer.from(buffer.subarray(payloadStart, end));
  for (let index = 0; index < payload.length; index += 1) {
    payload[index] ^= mask[index % MASK_BYTES];
  }
  return { opcode, payload, end };
}

/** Maps a parsed frame to the shape the fake server consumes. Other opcodes carry nothing it acts on. */
function toClientFrame(frame: ParsedFrame): ClientFrame | null {
  if (frame.opcode === OPCODE_TEXT) {
    return { opcode: frame.opcode, text: frame.payload.toString("utf8") };
  }
  if (frame.opcode === OPCODE_CLOSE || frame.opcode === OPCODE_PING) {
    return { opcode: frame.opcode, text: "" };
  }
  return null;
}

/**
 * Extract complete client frames from the buffer. Client frames must be
 * masked, unfragmented and at most MAX_FRAME_PAYLOAD_BYTES long. On a
 * violation the frames before it are still returned together with the error.
 */
export function readFrames(buffer: Buffer): ReadFramesResult {
  const frames: ClientFrame[] = [];
  let offset = 0;
  try {
    let parsed = parseFrame(buffer, offset);
    while (parsed !== null) {
      const clientFrame = toClientFrame(parsed);
      if (clientFrame !== null) frames.push(clientFrame);
      offset = parsed.end;
      parsed = parseFrame(buffer, offset);
    }
  } catch (error: unknown) {
    if (error instanceof WebSocketProtocolError) {
      return { frames, rest: buffer.subarray(offset), protocolError: error };
    }
    throw error;
  }
  return { frames, rest: buffer.subarray(offset), protocolError: null };
}
