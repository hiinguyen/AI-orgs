/**
 * Phase 10 checks: the Claude Code hook bridge. The pure mapping, privacy and
 * reaper checks live in `bridgeMapping.ts`; the capability, HTTP and WebSocket
 * checks live in `bridgeWire.ts`.
 */
import type { TestReporter } from "./harness.ts";
import { runBridgeMappingSuites } from "./bridgeMapping.ts";
import { runBridgeWireSuites } from "./bridgeWire.ts";

export async function runBridgeSuite(
  reporter: TestReporter,
): Promise<void> {
  runBridgeMappingSuites(reporter);
  await runBridgeWireSuites(reporter);
}
