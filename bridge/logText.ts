/**
 * Console-safe text for capture mode. Hook bodies are untrusted, so key names
 * and event names are stripped of control characters (including ANSI escapes)
 * and capped before they reach a terminal.
 */

// ESC-introduced sequences first, then any remaining C0, DEL and C1 controls.
const ANSI_SEQUENCE =
  /\u001b(?:\[[0-?]*[ -\/]*[@-~]|\][^\u0007\u001b]*(?:\u0007|\u001b\\)?|[@-Z\\-_])/g;
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g;

export function sanitizeLogText(value: string, maxLength: number): string {
  const clean = value.replace(ANSI_SEQUENCE, "").replace(CONTROL_CHARS, "?");
  return clean.length > maxLength ? `${clean.slice(0, maxLength)}...` : clean;
}
