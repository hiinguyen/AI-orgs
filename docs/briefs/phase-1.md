# Phase 1 brief: scaffold + domain + simulation engine (no 3D yet)

Read `AGENTS.md`, `docs/PLAN.md` and the whole of `docs/spec/ai-agent-world.md` first.

## 1. Scaffold the Next.js app by hand

The directory only contains docs, `AGENTS.md` and `.claude`; do NOT run create-next-app (it refuses non-empty dirs).

- `package.json` with exactly the scripts in spec section 1, `"private": true`, and the versions pinned in `docs/PLAN.md`. Install with npm.
  TypeScript must be ~5.9.3 and eslint ^9, not the newer majors.
- `tsconfig.json`: strict, moduleResolution bundler, `allowImportingTsExtensions: true`, noEmit, `@/*` -> `src/*`, Next plugin.
- `next.config.ts` per spec section 1, `postcss.config.mjs` with `@tailwindcss/postcss`, `eslint.config.mjs` (flat config with eslint-config-next core-web-vitals + typescript).
- `.gitignore` for node_modules, .next, next-env.d.ts, *.tsbuildinfo, .opencode-logs.
- `src/app/layout.tsx`, `src/app/page.tsx` (a simple placeholder that says "AI Agent World - Simulation mode, no live inference"), `src/app/globals.css` with `@import "tailwindcss";` and the `@theme` tokens from spec 7.1. The utility classes come in phase 2.

## 2. Domain and engine

Implement everything in spec sections 3, 4 and 5, plus the `AgentBackend` contract and `MockAgentBackend` from 3.5, in the folder layout of section 2:

- `src/agents/agentTypes.ts`, `AgentRegistry.ts`, `AgentController.ts`
- `src/tasks/taskTypes.ts`, `taskActions.ts`, `taskBacklog.ts`
- `src/events/eventTypes.ts`, `eventStore.ts`
- `src/simulation/SimulationEngine.ts`, `WorkflowStateMachine.ts`, `TaskScheduler.ts`, `EventBus.ts` (with seeded RNG + `hashString`), `simulationConfig.ts`, `worldLayout.ts`, `workContent.ts`
- `src/integrations/AgentBackend.ts`, `MockAgentBackend.ts`

All of these use explicit `.ts` sibling imports and import nothing from React, three, Next or `@/` (spec pitfall 4).

Follow the phase choreography in 4.2 exactly, including which events are `feed:false`, a `CommLink` push on every talk, pause/block semantics, ambient behaviour and reset.

`workContent.ts`: all 15 domains from 4.3 plus GENERIC, each with 5-6 subtasks, 3 findings, 3 test names and 2 review notes written like a senior engineer.
The auth/jwt template must include the test "rejects expired access token" and the subtasks and findings visible in `docs/spec/reference-screenshots/02-demo-qa-fails.jpg`:
subtasks "Define user + credential schema", "POST /auth/register with password hashing", "POST /auth/login issuing JWT access token", "Refresh-token rotation endpoint", "Auth middleware for protected routes", "Rate-limit login attempts";
findings "Short-lived access tokens (15 min) + rotating refresh tokens", "Hash passwords with argon2id; never log credentials", "Sign tokens with asymmetric keys to allow key rotation".

`taskBacklog.ts`: 18 tasks, the two scripted ones, `SPRINT_TASKS`, `pickRandomTask`, `TASK_SUGGESTIONS`, exactly as 4.4 describes.

## 3. Tests

`scripts/simulate.ts` implements ALL six check groups of spec section 9, prints a check mark or cross line per check, and exits 1 on any failure.

## 4. Verify

Run `npm run typecheck`, `npm run lint`, `npm test` and fix until all pass with zero lint warnings.
Also run `npm run build` once to prove the app compiles.

Do not build any UI beyond the placeholder page: no store, no 3D.
Stop after phase 1 and print your report.
