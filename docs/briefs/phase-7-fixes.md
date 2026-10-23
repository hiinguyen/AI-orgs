# Phase 7 review fixes

You are the implementer (see `AGENTS.md`).
Branch `phase-7-sound` is checked out with the phase 7 work uncommitted in the working tree.
Do not revert or rewrite it; fix only the items below.
Typecheck, lint, test (273 checks) and build currently pass, and must still pass at the end.

Read `docs/briefs/phase-7.md` and spec section 8 and pitfall 5 for context.

## Fixes

1. **HIGH: unlock listeners are removed even when the gesture cannot unlock audio** (`src/audio/useSoundEffects.ts` near lines 48-54, `src/audio/soundEngine.ts` near lines 80-93).
   `unlock()` calls `resume()` and swallows a rejection, and the hook removes the listeners right after, unconditionally.
   Chrome does not count Escape keydown or a touch `pointerdown` as activating input (touch activates at `pointerup`).
   If the first input is Escape or a phone touch, the context stays `suspended`, no listener is left, and sound is dead for the whole session.
   Fix:
   - `unlock()` returns (or exposes) whether the context is `running` after `resume()` settles.
   - Keep the listeners until the context is `running`; remove them then (check after `resume()` resolves, and also react to the context's `statechange`).
   - Also listen for `pointerup` and `click` in addition to `pointerdown` and `keydown`.
   - Cleanup on unmount still removes everything; StrictMode double mount still leaves exactly one listener set.
   - Add a check in `scripts/tests/sound.ts` with a fake `AudioContext` whose `resume()` stays `suspended` the first time: the listeners must stay, a second gesture retries, and they are removed only after the state becomes `running`.
2. **MEDIUM: `play()` and ambient run against a context that is not running** (`src/audio/soundEngine.ts` near lines 111-117 and 190-201).
   While the context exists but is `suspended` or `interrupted`, `play()` builds nodes against a frozen `currentTime`; they never fire `onended`, leak, and all start in one burst when the context resumes.
   Gate `play()` and the ambient start on `context.state === "running"` (silent no-op otherwise, matching the brief's wording).
   When the context becomes `running` and the engine is in the running state with ambient on, start the ambient bed then (so a late unlock still gets the bed).
   Add a check with the fake context: `play()` while suspended creates no nodes; after it becomes running, cues create nodes again; the ambient bed starts after a late unlock.
3. **MEDIUM (small): ambient fade-out disconnect uses a wall-clock timer** (`src/audio/soundEngine.ts` near lines 281-283).
   The fade runs on audio time but the disconnect runs on a `setTimeout` that is never cleared.
   Disconnect the bed from the last source's `onended` instead (or clear the timer on every start and on dispose), so a suspended context cannot desync them.
   Keep the check for ambient start and stop passing, and add one for start, stop, start again quickly (no double bed, no disconnected live bed).
4. **LOW: dead code** (`src/components/layout/AppShell.tsx`, `case "escape"` at the bottom of the shortcut switch).
   Escape returns earlier, so the case is dead; remove it, or move the early return so the case is the single place that handles Escape.
   Keep Escape behaviour identical (clear selection and stop following, ignored while typing).
5. **LOW: unexplained scope** (`src/world/WorldCanvas.tsx` `completedAt` in the `?debug` probe).
   Keep it, but add a one-line comment saying it is used by the browser checks.

## Rules

- Same rules as `docs/briefs/phase-7.md`: no audio files, no per-event React re-render, no work in `useFrame`, no em dashes, no `any`, files under 800 lines.
- Do not change the cue table or the throttle values.
- Verify: `npm run typecheck`, `npm run lint` (zero warnings), `npm test`, `npm run build` all pass.
- Browser (production build, headless Chromium, default autoplay policy): first input is Escape, then a click: the context ends `running` and cues fire; first input is a touch-style `pointerdown` without `pointerup` (dispatch it with CDP touch events if you can), then the full tap: same result; demo order and timing unchanged; zero console errors.
  Screenshots are optional this round.
- Do not commit.
- Finish with the short report required by `AGENTS.md`.
