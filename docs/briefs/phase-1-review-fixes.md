# Phase 1 PR review fixes

You are the implementer (see `AGENTS.md`).
Phase 1 is implemented in the working tree on branch `phase-1-engine`.
An independent review of PR #1 found the issues below; the reviewer reproduced the HIGH one.
Fix all of them, in this order.

## 1. HIGH - a task entering a phase owned by a paused agent is never blocked

Spec 3.2: while the responsible agent is paused, the task status is overridden to `blocked` with a `blockedReason`.
Today blocking only happens inside `pauseAgent`, for tasks already assigned to that agent at that moment.
`applySignal` clears `blockedReason` and sets `status = PHASE_STATUS[to]`, and `applyAndEnter` (`src/simulation/SimulationEngine.ts`) never checks whether the new owner is paused.

Reproduction: submit the demo task, `pauseAgent("quinn")` while the task is in implementation (owner Kai).
When Kai submits, the task enters testing with `status: "testing"`, `blockedReason: null`, owner Quinn, sits at progress 0.62 forever, and no `task.blocked` is emitted; `resumeAgent("quinn")` emits no `task.unblocked`.
Same with pausing Piper while Orion is talking to her: the task lands in planning owned by paused Piper and stays `in_progress`.

Fix: one helper that applies the blocked override (status `blocked`, `blockedReason` "<Name> is paused", emit `task.blocked`), used both by `pauseAgent` and by `applyAndEnter` when the new owner is paused.
Unblocking must restore the status from the `PHASE_STATUS` projection (keep that the single source) and emit `task.unblocked`.

## 2. MEDIUM - strengthen tests in `scripts/simulate.ts`

- Regression for fix 1: pause each phase owner in turn (Piper, Iris, Kai, Quinn, Rex) *before* the task reaches their phase; assert the task becomes `blocked` with the right reason and emits `task.blocked` when it enters that phase, then `resumeAgent` emits `task.unblocked`, restores the projected status, and the task still completes.
- "a paused simulation does not move agents" is vacuous today (at 2 s nobody is walking yet). Pause while at least one agent is actually walking (assert that first), then assert positions are unchanged.
- "resuming the owner unblocks the task" must assert the restored status equals the phase projection, not just `!== "blocked"`.
- Determinism: compare the full event stream (id, type, simTime, message, agentId, targetAgentId, taskId) of two fresh demo runs, not only the final clock and phase order.
- "low starts after a slot frees up" must assert the low task's first history transition happens at or after the earlier of the other two tasks' completion times.
- Add a reset-mid-flight check: two tasks in flight plus one paused agent, `reset()`, then assert 0 tasks, `ready`, clock 0, every agent idle, unpaused and at its home slot, and a new task gets id `T-001` and completes.

## 3. LOW - reset and config

- `reset()` must also reset the event id counter (`eventSeq`), so a post-reset run reproduces the same event ids as a fresh engine. Add a check for that.
- `reset()` currently resets `speed` to `defaultSpeed`. The spec does not ask for that; keep the user's current speed across reset.
- `config.maxEvents` is unused while `src/events/eventStore.ts` hardcodes `400`. Use the config value (spec: ALL limits live in `simulationConfig.ts`).

## 4. LOW - dead code and duplication

- Remove unused code: `TaskScheduler.queuedCount`, `AgentController.id`, `EventBus.clear` / `EventBus.size`, `TERMINAL_PHASES`, unless something now uses them. Verify with grep before deleting.
- `decideTesting` and `decideReview` in `src/simulation/phaseChoreography.ts` share the same fail/pass structure (~90 lines each). Extract one shared outcome + handoff helper so each becomes a short declarative call. Behaviour must not change.

## Verify

Before starting, record the demo finish clock and tick count (time of `task.completed` for `DEMO_TASK` at 1/30 s ticks).
After all fixes it must be identical: none of these changes may alter the unpaused demo timeline.
Run `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`; all must pass with zero lint warnings.
Print a short report: what changed per item, the new check count, and the demo finish clock before and after.
Do not touch anything outside this list and do not commit.
