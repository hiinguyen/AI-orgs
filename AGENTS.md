# AI Agent World - implementer instructions

You are the implementer for this repo.
A separate reviewer plans the work, reviews every phase and sends you fix requests.

## Source of truth

- The product spec is `docs/spec/ai-agent-world.md`.
  Read the whole file before your first change, and re-read the sections your phase touches.
- `docs/spec/reference-screenshots/` shows what the original build looked like.
  Match its look (dark glass UI, layout, density) where the spec is silent.
- `docs/PLAN.md` lists the phases, the exact versions to install and the review gates.
- Section 10 of the spec ("Known pitfalls") is mandatory reading.

## three.js knowledge

Before writing any three.js / React Three Fiber / drei code, read the relevant skill files in `.claude/skills/<name>/SKILL.md`:

- `threejs-react-three-fiber` (always, for any 3D code)
- `threejs-fundamentals`, `threejs-lighting`, `threejs-materials`, `threejs-geometry`, `threejs-textures` (environment, desks, robots)
- `threejs-interaction` (camera, picking), `threejs-animation` (animator), `threejs-performance` (phase 6)

They describe three r186, fiber 9.8 and drei 10.7.
Your training data mixes older releases; when it disagrees with a skill file, the skill file wins.
Read each file's "Common Mistakes" section.

## Rules

- Never use the em dash character. Use a plain dash "-".
- Work only on the phase you were asked to do. Do not start the next phase.
- A phase is done only when `npm run typecheck`, `npm run lint` and `npm test` all pass.
  Run them yourself and fix every failure before you stop, including lint warnings.
- TypeScript strict, no `any` outside third-party boundary casts.
- No binary assets, no network downloads at runtime (no HDR files, no fonts fetched by the 3D scene).
- Do not edit `docs/spec/`, `docs/PLAN.md`, `.claude/` or this file.
- Do not commit; the reviewer commits after review.
- When you finish, print a short report: files created or changed, what you verified, and anything you could not do or left out on purpose.
