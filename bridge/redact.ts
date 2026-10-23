/**
 * Privacy boundary for Claude Code hook payloads. Hook JSON carries prompts,
 * file contents and shell commands, so the bridge never forwards those values.
 * These pure helpers produce the only text that is allowed into a robot's
 * activity line, with obvious secrets masked before anything leaves the hook.
 */

const MAX_TOOL_NAME = 40;
const MAX_TARGET = 80;
const MAX_COMMAND = 60;
const MAX_SUMMARY = 120;
/**
 * Upper bound on what `redact` scans. The patterns below backtrack
 * quadratically on long identifier or `://` runs, so an unbounded input could
 * block the single-threaded bridge. Every value the bridge displays is far
 * shorter than this, so only the tail of longer input is dropped.
 */
export const MAX_REDACT_INPUT = 2048;

const AUTHORIZATION_PATTERN =
  /\bAuthorization\b\s*[:=]\s*(?:(?:Bearer|Basic|Token|Digest)\s+)?(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi;
const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9\-._~+/]+=*/gi;
// Identifier prefix/suffix lets GITHUB_TOKEN, DB_PASSWORD and
// AWS_SECRET_ACCESS_KEY match. The two `[A-Za-z0-9_]*` runs overlap, so the
// scan is quadratic in the length of an identifier run. `redact` caps its
// input at MAX_REDACT_INPUT before running this pattern.
const SECRET_ASSIGNMENT_PATTERN =
  /\b([A-Za-z0-9_]*(?:token|password|passwd|pwd|secret|api[_-]?key|access[_-]?key)[A-Za-z0-9_]*)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s&;|,]+)/gi;
const SECRET_FLAG_PATTERN =
  /--(password|passwd|token|secret|api[_-]?key)(?:\s+|=)(?:"[^"]*"|'[^']*'|\S+)/gi;
const BASIC_AUTH_FLAG_PATTERN = /(^|\s)-u\s+\S+:\S+/g;
const URL_CREDENTIALS_PATTERN = /:\/\/[^/\s:@]+:[^@\s]+@/g;
const SK_KEY_PATTERN = /\bsk-[A-Za-z0-9_-]{6,}\b/g;
const GITHUB_TOKEN_PATTERN = /\bgh[pousr]_[A-Za-z0-9]{10,}\b/g;
const AWS_ACCESS_KEY_PATTERN = /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g;

/** Collapse whitespace and cap a display string. */
export function truncate(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

/**
 * Mask the obvious secret shapes in a command or free text.
 *
 * Whitespace is collapsed first, in one linear pass, so the length cap counts
 * the characters that can be displayed. Without this, a long run of spaces
 * could push a secret's start just inside the cap and leave a short fragment
 * of it unmasked. The cap then runs before any backtracking pattern.
 */
export function redact(value: string): string {
  const bounded = value.replace(/\s+/g, " ").slice(0, MAX_REDACT_INPUT);
  return bounded
    .replace(AUTHORIZATION_PATTERN, "Authorization: [redacted]")
    .replace(BEARER_PATTERN, "Bearer [redacted]")
    .replace(URL_CREDENTIALS_PATTERN, "://[redacted]@")
    .replace(SECRET_FLAG_PATTERN, "--$1 [redacted]")
    .replace(BASIC_AUTH_FLAG_PATTERN, "$1-u [redacted]")
    .replace(SECRET_ASSIGNMENT_PATTERN, "$1=[redacted]")
    .replace(SK_KEY_PATTERN, "[redacted]")
    .replace(GITHUB_TOKEN_PATTERN, "[redacted]")
    .replace(AWS_ACCESS_KEY_PATTERN, "[redacted]")
    .trim();
}

/** Make an absolute path relative to the hook's working directory. */
export function relativePath(value: string, cwd: string | null): string {
  const path = value.trim();
  if (path.length === 0) return "";

  const cwdParts =
    cwd === null ? [] : cwd.split("/").filter((part) => part.length > 0);
  if (!path.startsWith("/") || cwdParts.length === 0) return path;

  const pathParts = path.split("/").filter((part) => part.length > 0);
  let common = 0;
  while (
    common < pathParts.length &&
    common < cwdParts.length &&
    pathParts[common] === cwdParts[common]
  ) {
    common += 1;
  }
  const up = cwdParts.length - common;
  const relative = [
    ...Array.from({ length: up }, () => ".."),
    ...pathParts.slice(common),
  ].join("/");
  return relative.length > 0 ? relative : ".";
}

function readString(
  record: Record<string, unknown>,
  key: string,
): string | null {
  const value = record[key];
  return typeof value === "string" ? value : null;
}

const FILE_TOOLS: ReadonlySet<string> = new Set([
  "read",
  "write",
  "edit",
  "multiedit",
  "notebookedit",
  "glob",
  "grep",
  "ls",
  "view",
  "create",
  "applypatch",
]);

const FILE_PATH_FIELDS = [
  "file_path",
  "filePath",
  "notebook_path",
  "path",
] as const;

function safeToolName(toolName: string): string {
  const clean = toolName.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return truncate(clean.length > 0 ? clean : "tool", MAX_TOOL_NAME);
}

function fileTarget(
  toolInput: Record<string, unknown> | null,
  cwd: string | null,
): string | null {
  if (toolInput === null) return null;
  for (const field of FILE_PATH_FIELDS) {
    const value = readString(toolInput, field);
    if (value !== null && value.trim().length > 0) {
      return truncate(relativePath(value, cwd), MAX_TARGET);
    }
  }
  return null;
}

/**
 * The activity target for a tool call:
 * - file tools: the path relative to cwd
 * - Bash: the first 60 characters of the command, secrets masked
 * - Agent/Task: the short description
 * - everything else: the tool name only
 */
export function toolTarget(
  toolName: string,
  toolInput: Record<string, unknown> | null,
  cwd: string | null,
): string {
  const name = safeToolName(toolName);
  const lower = name.toLowerCase();

  if (lower === "bash" || lower === "shell") {
    const command = toolInput === null ? null : readString(toolInput, "command");
    if (command === null) return name;
    const masked = redact(command);
    return masked.length > 0 ? truncate(masked, MAX_COMMAND) : name;
  }

  if (lower === "agent" || lower === "task") {
    const description =
      toolInput === null ? null : readString(toolInput, "description");
    if (description === null) return name;
    const masked = redact(description);
    return masked.length > 0 ? truncate(masked, MAX_TARGET) : name;
  }

  if (FILE_TOOLS.has(lower)) {
    const target = fileTarget(toolInput, cwd);
    if (target !== null) return target;
  }

  return name;
}

/** Read a short, redacted finish summary from `last_assistant_message`. */
export function summaryFromMessage(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const masked = redact(value);
  return masked.length > 0 ? truncate(masked, MAX_SUMMARY) : null;
}
