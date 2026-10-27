/**
 * Validation for the untrusted hook body that Claude Code POSTs to the bridge.
 * Only the fields the mapping actually uses are normalised; everything else is
 * ignored and never stored or logged. A malformed field rejects the request,
 * while an unknown event name is a deliberate no-op.
 */
import { isAgentId } from "../src/agents/agentTypes.ts";
import { sanitizeLogText } from "./logText.ts";

const CAPTURE_MAX_KEYS = 32;
const CAPTURE_KEY_MAX = 40;
const CAPTURE_EVENT_NAME_MAX = 64;

export const HOOK_EVENT_NAMES = [
  "SessionStart",
  "SessionEnd",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "PostToolUseFailure",
  "SubagentStart",
  "SubagentStop",
  "Stop",
] as const;

export type HookEventName = (typeof HOOK_EVENT_NAMES)[number];

const HOOK_EVENT_SET: ReadonlySet<string> = new Set(HOOK_EVENT_NAMES);
const TOOL_EVENTS: ReadonlySet<string> = new Set([
  "PreToolUse",
  "PostToolUse",
  "PostToolUseFailure",
]);

export interface HookPayload {
  eventName: HookEventName;
  sessionId: string;
  cwd: string;
  agentId: string | null;
  agentType: string | null;
  toolName: string | null;
  toolInput: Record<string, unknown> | null;
  lastAssistantMessage: string | null;
  /** The user prompt on UserPromptSubmit, bounded and never logged. */
  prompt: string | null;
}

export type HookParseResult =
  | { kind: "ok"; payload: HookPayload }
  | { kind: "ignored"; eventName: string }
  | { kind: "invalid"; reason: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBoundedText(value: unknown, max: number): value is string {
  if (typeof value !== "string") return false;
  if (value.length === 0 || value.length > max) return false;
  return !/[\u0000-\u001f\u007f]/.test(value);
}

/**
 * A prompt may span lines, so only the control characters that break logs or
 * terminals are rejected. Length is clamped, not rejected: a pasted prompt
 * should still become a task.
 */
const MAX_PROMPT_LENGTH = 20_000;

function readPrompt(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) return null;
  return value.length > MAX_PROMPT_LENGTH
    ? value.slice(0, MAX_PROMPT_LENGTH)
    : value;
}

function invalid(reason: string): HookParseResult {
  return { kind: "invalid", reason };
}

export function parseHookPayload(body: unknown): HookParseResult {
  if (!isRecord(body)) return invalid("hook body must be a JSON object");

  const rawEvent = body.hook_event_name;
  if (typeof rawEvent !== "string" || rawEvent.length === 0) {
    return invalid("hook_event_name must be a non-empty string");
  }
  if (!HOOK_EVENT_SET.has(rawEvent)) {
    return { kind: "ignored", eventName: rawEvent.slice(0, 80) };
  }
  const eventName = rawEvent as HookEventName;

  const sessionId = body.session_id;
  if (typeof sessionId !== "string" || !isAgentId(sessionId)) {
    return invalid("session_id must be a bounded id string");
  }

  const cwd = body.cwd;
  if (!isBoundedText(cwd, 4096)) {
    return invalid("cwd must be a bounded path string");
  }

  const rawAgentId = body.agent_id;
  let agentId: string | null = null;
  if (rawAgentId !== undefined && rawAgentId !== null) {
    if (typeof rawAgentId !== "string" || !isAgentId(rawAgentId)) {
      return invalid("agent_id must be a bounded id string");
    }
    agentId = rawAgentId;
  }

  const rawAgentType = body.agent_type;
  let agentType: string | null = null;
  if (rawAgentType !== undefined && rawAgentType !== null) {
    if (typeof rawAgentType !== "string" || rawAgentType.length > 120) {
      return invalid("agent_type must be a bounded string");
    }
    if (/[\u0000-\u001f\u007f]/.test(rawAgentType)) {
      return invalid("agent_type must not contain control characters");
    }
    agentType = rawAgentType;
  }

  const rawToolName = body.tool_name;
  let toolName: string | null = null;
  if (rawToolName !== undefined && rawToolName !== null) {
    if (!isBoundedText(rawToolName, 120)) {
      return invalid("tool_name must be a bounded string");
    }
    toolName = rawToolName;
  }
  if (TOOL_EVENTS.has(eventName) && toolName === null) {
    return invalid(`${eventName} needs a tool_name`);
  }

  const rawToolInput = body.tool_input;
  let toolInput: Record<string, unknown> | null = null;
  if (rawToolInput !== undefined && rawToolInput !== null) {
    if (!isRecord(rawToolInput)) {
      return invalid("tool_input must be an object");
    }
    toolInput = rawToolInput;
  }

  const rawSummary = body.last_assistant_message;
  let lastAssistantMessage: string | null = null;
  if (rawSummary !== undefined && rawSummary !== null) {
    if (typeof rawSummary !== "string" || rawSummary.length > 20_000) {
      return invalid("last_assistant_message must be a bounded string");
    }
    lastAssistantMessage = rawSummary;
  }

  const prompt = readPrompt(body.prompt);

  if (eventName === "SubagentStart" || eventName === "SubagentStop") {
    if (agentId === null) return invalid(`${eventName} needs an agent_id`);
  }
  // Internal agents announce an empty agent_type, so presence matters, not
  // length. SubagentStart without the field is malformed.
  if (eventName === "SubagentStart" && rawAgentType === undefined) {
    return invalid("SubagentStart needs an agent_type");
  }

  return {
    kind: "ok",
    payload: {
      eventName,
      sessionId,
      cwd,
      agentId,
      agentType,
      toolName,
      toolInput,
      lastAssistantMessage,
      prompt,
    },
  };
}

function typeName(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

/**
 * Capture-mode description: event name plus every field name and value type,
 * never a value. Safe to print while developing real hooks.
 */
export function describeHookShape(body: unknown): string {
  if (!isRecord(body)) return "invalid body";
  const name =
    typeof body.hook_event_name === "string"
      ? sanitizeLogText(body.hook_event_name, CAPTURE_EVENT_NAME_MAX)
      : "(missing event)";
  const keys = Object.keys(body).sort();
  const shown = keys
    .slice(0, CAPTURE_MAX_KEYS)
    .map(
      (key) =>
        `${sanitizeLogText(key, CAPTURE_KEY_MAX)}:${typeName(body[key])}`,
    );
  if (keys.length > CAPTURE_MAX_KEYS) {
    shown.push(`+${keys.length - CAPTURE_MAX_KEYS} more`);
  }
  const fields = shown.join(", ");
  return fields.length > 0 ? `${name} { ${fields} }` : `${name} { }`;
}
