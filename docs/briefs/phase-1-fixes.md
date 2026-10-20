# Phase 1 review fixes

Reviewer gate result: typecheck, lint, 54/54 tests and build are green, and the choreography matches spec 4.2. Fix these before the phase is merged:

1. `package.json`: `"lucide-react": "latest"` must be a real range. Pin it to `^1.60.0` (the installed version) and update the lockfile with npm.
2. Success emotes use the wrong duration. Quinn's pass emote and Rex's approve emote in `SimulationEngine.ts` use `durations.errorEmote`; they must use `durations.celebrate`. `errorEmote` is only for the fail and changes-requested emotes. `celebrate` is currently unused anywhere.
3. Pluralisation: "is shipped after 1 iterations" and "failed after 1 iterations" read wrong. Use "1 iteration" vs "N iterations" in both messages.
4. `src/simulation/SimulationEngine.ts` is 1191 lines; the repo limit is 800 lines per file.
   Move the per-phase choreography (scheduleIntake, schedulePlanning, scheduleResearch, scheduleImplementation, scheduleTesting, decideTesting, scheduleReview, decideReview, scheduleFinale, rework) into a cohesive module such as `src/simulation/phaseChoreography.ts` that the engine calls, with a small explicit interface for what it needs from the engine (emit, pushLink, applyAndEnter, setProgress, tickSubtasks, task/meta/controller lookup).
   Keep the pure-module rules (explicit `.ts` imports, no React/three/Next/`@/`).
   Behaviour must not change: the demo must still finish at the same clock to the tick. Before refactoring, record the demo finish clock from `npm test` output or a quick script, and confirm it is identical afterwards (it will change slightly only because of fix 2, so do fix 4 first, verify identical, then do fix 2).

Then run `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` and print a short report with the demo finish clock before and after.
Do not touch anything else and do not commit.
