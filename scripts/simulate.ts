/**
 * Headless checks, run with:
 *   node --experimental-strip-types --no-warnings scripts/simulate.ts
 *
 * The suite lives in `scripts/tests/`: workflow (state machine, pause/reset),
 * engine (demo, determinism, concurrency, backlog), store (React mirror) and
 * backend (WebSocket boundary and recovery). Prints a check or cross per
 * assertion and exits 1 if anything fails.
 */
import { runBackendSuite } from "./tests/backend.ts";
import { runBoardsSuite } from "./tests/boards.ts";
import {
  runBacklogSuite,
  runConcurrencySuite,
  runDemoSuite,
} from "./tests/engine.ts";
import { runAgentsSuite } from "./tests/agents.ts";
import { runReducedMotionSuite } from "./tests/motion.ts";
import { runQualitySuite } from "./tests/quality.ts";
import { runSoundSuite } from "./tests/sound.ts";
import { runLiveAgentsSuite } from "./tests/liveAgents.ts";
import { runMirrorSuite } from "./tests/store.ts";
import { runLifecycleSuite, runStateMachineSuite } from "./tests/workflow.ts";
import type { TestReporter } from "./tests/harness.ts";

let checks = 0;
let failures = 0;

const reporter: TestReporter = {
  check(name, condition, detail) {
    checks += 1;
    if (condition) {
      console.log(`  \u2713 ${name}`);
    } else {
      failures += 1;
      console.log(`  \u2717 ${name}${detail ? ` - ${detail}` : ""}`);
    }
  },
  group(title) {
    console.log(`\n${title}`);
  },
};

async function main(): Promise<void> {
  console.log("AI Agent World - headless simulation checks");

  runStateMachineSuite(reporter);
  runDemoSuite(reporter);
  runLifecycleSuite(reporter);
  runConcurrencySuite(reporter);
  runBacklogSuite(reporter);
  runAgentsSuite(reporter);
  runMirrorSuite(reporter);
  runBoardsSuite(reporter);
  runQualitySuite(reporter);
  runReducedMotionSuite(reporter);
  await runSoundSuite(reporter);
  await runBackendSuite(reporter);
  await runLiveAgentsSuite(reporter);

  console.log("");
  if (failures === 0) {
    console.log(`All ${checks} checks passed.`);
  } else {
    console.log(`${failures} of ${checks} checks failed.`);
    process.exitCode = 1;
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
