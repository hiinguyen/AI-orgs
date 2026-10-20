# AI Agent World - build plan

Goal: rebuild AI Agent World exactly as specified in `docs/spec/ai-agent-world.md`.
Roles: opencode running `opencode-go/deepseek-v4.1-flash` implements; Claude Code plans, reviews and commits.

## Workflow per phase

1. Reviewer sends the phase brief to opencode (`opencode run --auto -m opencode-go/deepseek-v4.1-flash`).
2. Implementer builds the phase, runs typecheck, lint and test, and reports.
3. Reviewer gate:
   - re-runs `npm run typecheck`, `npm run lint`, `npm test`
   - reads the diff against the spec sections for that phase and the pitfalls in section 10
   - opens the app in a real browser (Chrome DevTools MCP) and checks the phase's acceptance criteria, console errors and visual quality against `docs/spec/reference-screenshots/`
4. Findings go back to opencode as a self-contained numbered fix list in `docs/briefs/phase-N-fixes.md`, run in a fresh session.
   Do not use `opencode run --session <id>`: on opencode v2.0.26 it hangs with no output (seen twice on 2026-10-20).
   Launch every run with `nohup ... --format json > .opencode-logs/<name>.jsonl < /dev/null &` so it survives the reviewer's session.
5. Repeat 3-4 until the gate is clean, then the reviewer commits `feat: phase N - <name>` on branch `phase-N-<name>` and pushes it.
6. Reviewer opens a PR to `main` and runs an independent review agent on it (code-reviewer, plus typescript-reviewer or security-reviewer where relevant).
7. Real findings from that review go back to opencode, get fixed, re-gated and pushed to the same PR.
8. Reviewer merges the PR, the next phase branches from the updated `main`.

## Pinned versions (verified on npm, 2026-10-20)

| Package | Version |
| --- | --- |
| next | ^16.4 |
| react, react-dom | ^19.3 |
| three | ^0.186 |
| @types/three | ~0.186 |
| @react-three/fiber | ^9.8 |
| @react-three/drei | ^10.7 |
| zustand | ^5 |
| tailwindcss, @tailwindcss/postcss | ^4 |
| lucide-react | latest |
| typescript | ~5.9.3 (not 7.x: the spec and the pitfalls target 5.9) |
| eslint | ^9 (not 10) with eslint-config-next ^16.4, flat config |
| @types/node | ^22 |

Node on this machine is v26, so `node --experimental-strip-types` works.

## Phases

| # | Scope (spec sections) | Gate |
| --- | --- | --- |
| 1 | Scaffold, sections 1-5: types, state machine, scheduler, event bus + seeded RNG, config, world layout, work content, demo + backlog + sprint, `SimulationEngine`, `MockAgentBackend`, `AgentBackend` contract, `scripts/simulate.ts` with every check in section 9 | `npm test` green, all six check groups present; placeholder page boots |
| 2 | Section 7 + store/backend client from 2 and 3.5: `useWorldStore` with `liveWorld` + throttled mirror, `backendClient`, `WebSocketAgentBackend`, full HTML shell, side panel tabs, task dialog, loading screen, shortcuts | Demo runs end to end in the HTML UI with an empty 3D area |
| 3 | Sections 6.1-6.3, 6.5-6.8: canvas, lighting, environment, workstations, camera presets + inset fit, interaction, shared resources | Static office looks finished, matches screenshots |
| 4 | Section 6.4: procedural robots per role, animator, routed walking, path trails, comm arcs, DOM speech bubbles, hover/select/follow | Demo watchable end to end: Orion, Piper, Iris, Kai, Quinn (fail), Kai, Quinn (pass), Rex, Orion |
| 5 | Mission control wall, planning board cards, desk screen glow, hub ring pulse | Wall and board reflect live tasks |
| 6 | Quality + performance: PerformanceMonitor fallback, low path, reduced motion, mobile bottom sheet, `?quality=` | No console errors under StrictMode, smooth frame rate, mobile layout usable |
| 7 | Section 8: Web Audio sound engine and hook | AudioContext running after a click, cues fire during demo |
| 8 | README, `scripts/e2e.py`, cleanup | Lint, typecheck, test green; definition of done in section 11 |

## Review checklist (every phase)

- Non-negotiables in section 0 hold: rendering never mutates sim state, determinism, honesty labels, no 30 Hz React renders, strict types, no binary assets.
- Files under `src/simulation`, `src/tasks`, `src/events`, non-React `src/agents/*.ts`, `src/integrations/AgentBackend.ts` use `.ts` import extensions and import nothing from React, three, Next or `@/`.
- No drei `<Html>`, no Canvas `key`, no `PCFSoftShadowMap`, no `THREE.Clock` in our code.
- No em dash characters anywhere.
- No console errors or warnings in the browser beyond the known fiber Clock deprecation warning.
- UI is pixel-clean: alignment, spacing, truncation, contrast, nothing overlapping at 1440x900 and 390x844.
