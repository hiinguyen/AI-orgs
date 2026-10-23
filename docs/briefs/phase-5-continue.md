# Phase 5 - continue

You are the implementer (see `AGENTS.md`).
Your task is still `docs/briefs/phase-5.md`; read it first.
A previous run implemented most of it on branch `phase-5-live-boards` (uncommitted working tree) and was stopped during the final browser verification, while it was taking close-up screenshots of the planning board.
Its work so far: `src/world/Desks.tsx`, `MissionControl.tsx`, `OperationsHub.tsx`, `PlanningBoard.tsx`, `missionContent.ts`, `missionDrawing.ts`, `planningContent.ts`, `scripts/tests/boards.ts`, and edits to `Workstations.tsx`, `proceduralTextures.ts`, `sharedResources.ts`, `AgentCharacter.tsx`, `scripts/simulate.ts`; screenshots and helper scripts in `.opencode-logs/phase5/`.

A second run then reworked `PlanningBoard.tsx`, `planningContent.ts`, `missionDrawing.ts`, `MissionControl.tsx`, `Desks.tsx`, `proceduralTextures.ts` and `src/simulation/worldLayout.ts`, passed typecheck, lint, test and build, and took screenshots of the board (cards, done tint), desk glow (Kai, Quinn), the hub and the sprint (`sprint-*.jpg`).
It died from context exhaustion while checking the sprint screenshots, after about 40 full-size image reads.
Still not verified by it: demo order at 1x and 4x, `interaction-test.mjs`, draw calls at overview (high and low), `?quality=low`, mobile 390x844, console, and the sprint result (wall lists several tasks, board fills with cards).

Context budget (mandatory): never Read a full-size screenshot more than once.
To inspect a detail, crop it with PIL to a region of at most 800 px wide and read the crop; keep total image reads under about 15.
Check state numerically through `window.__AAW_DEBUG_STATE__` and `__AAW_DRAW_CALLS__` instead of by eye where you can.

Do this:

1. Check the working tree against every item of `docs/briefs/phase-5.md` (Build 1-5, Quality, Verify) and finish whatever is missing or wrong.
   Do not rewrite work that already meets the brief.
2. Run the full Verify list of `docs/briefs/phase-5.md` yourself and fix every failure, including anything that looks off in the screenshots (planning board cards must be clearly visible and readable from the Collaboration or Overview preset, Mission Control text readable at overview).
3. Keep your context small: read only what you need and use `sed -n` / `grep` for large files.
4. Do not commit.
   Print the report `AGENTS.md` asks for, including draw calls at overview (high and low) and the list of screenshots.
