import type { CreateTaskInput } from "./taskTypes.ts";
import { DEMO_TASK } from "./taskActions.ts";

/**
 * Realistic product work. Titles carry the domain keywords the work template
 * matcher uses, descriptions stay to one or two sentences.
 */
export const TASK_BACKLOG: readonly CreateTaskInput[] = [
  {
    title: "Patch session token leak in password-reset flow",
    description:
      "Reset links currently log the raw session token at info level and keep it valid after use. Rotate the token on redemption and scrub the logging path.",
    priority: "critical",
    script: { qaFailsOn: [1], reviewChangesOn: [2] },
  },
  {
    title: "Migrate legacy billing cron to event-driven pipeline",
    description:
      "Replace the nightly billing cron with an idempotent event pipeline, backfill historical charges and keep the old writer in shadow mode until parity is proven.",
    priority: "high",
    script: { qaFailsOn: [1, 2, 3] },
  },
  {
    title: "Fix memory leak in the image-processing worker",
    description:
      "Worker pods grow by roughly 400 MB per day under normal traffic. Reproduce the leak, release buffers on every code path and add a soak test.",
    priority: "critical",
  },
  {
    title: "Export monthly revenue report as CSV",
    description:
      "Finance needs a downloadable report with one row per account and a stable column contract. The largest month is about 1.2 million rows.",
    priority: "low",
  },
  {
    title: "Add end-to-end search indexing for the product catalog",
    description:
      "Search misses newly published products until the next nightly rebuild. Add incremental indexing and a resumable backfill for the existing catalog.",
    priority: "medium",
  },
  {
    title: "Real-time presence indicators for the workspace",
    description:
      "Show who is viewing a workspace right now over WebSocket, including reconnect handling and stale-session cleanup.",
    priority: "medium",
  },
  {
    title: "Stripe checkout retry handling",
    description:
      "Checkout fails permanently when the payment provider returns a transient error. Add idempotent retries and surface recoverable declines to the customer.",
    priority: "high",
  },
  {
    title: "Localise onboarding emails for five markets",
    description:
      "Translate the onboarding sequence into German, French, Japanese, Portuguese and Spanish, including plural forms and local date formats.",
    priority: "medium",
  },
  {
    title: "Notification digest with per-user preferences",
    description:
      "Users receive one email per event today. Batch events into a daily digest that respects each user's timezone and channel preferences.",
    priority: "low",
  },
  {
    title: "Mobile offline sync for field technicians",
    description:
      "Technicians lose edits in basements with no signal. Queue mutations locally, reconcile conflicts deterministically and sync on reconnect.",
    priority: "high",
  },
  {
    title: "Harden rate limiting and SSO callback validation",
    description:
      "Login endpoints share no limit across pods and the SSO callback accepts any state parameter. Move limits to a shared store and validate state and redirect origins.",
    priority: "high",
  },
  {
    title: "REST endpoints for team invitations",
    description:
      "Add create, list and revoke endpoints for invitations with cursor pagination and field-level validation errors.",
    priority: "medium",
  },
  {
    title: "Dashboard component library refresh",
    description:
      "The analytics dashboard has drifted into four different card styles. Extract shared primitives and cover loading, empty and error states.",
    priority: "low",
  },
  {
    title: "Database migration for the multi-tenant schema",
    description:
      "Move tenant data onto a shared schema with row-level isolation. The migration must run online with a replayable backfill.",
    priority: "high",
  },
  {
    title: "Deploy canary pipeline for the API gateway",
    description:
      "Ship gateway releases to a canary slice first, promote on a clean error budget and roll back automatically when the error rate regresses.",
    priority: "medium",
  },
  {
    title: "LLM summary of support threads",
    description:
      "Summarise long support threads for the triage queue, redact personal data before the provider call and cache by thread revision.",
    priority: "medium",
  },
  {
    title: "Parquet export for analytics events",
    description:
      "Analytics wants daily Parquet exports instead of CSV. Stream the encoding and hand out short-lived signed links.",
    priority: "low",
  },
  {
    title: "Audit session handling in the admin console",
    description:
      "Admin sessions live for 30 days and survive password changes. Shorten the lifetime, revoke on password change and add an audit trail.",
    priority: "medium",
  },
];

function cloneInput(input: CreateTaskInput): CreateTaskInput {
  return {
    ...input,
    script: input.script
      ? {
          qaFailsOn: input.script.qaFailsOn
            ? [...input.script.qaFailsOn]
            : undefined,
          reviewChangesOn: input.script.reviewChangesOn
            ? [...input.script.reviewChangesOn]
            : undefined,
        }
      : undefined,
  };
}

function taskByTitle(title: string): CreateTaskInput {
  const found = TASK_BACKLOG.find((task) => task.title === title);
  if (!found) throw new Error(`Backlog task not found: ${title}`);
  return cloneInput(found);
}

/**
 * Eight-task sprint: both scripted tasks, the two criticals, a visible
 * low-priority export and a mix of domains so the feed stays varied.
 */
export const SPRINT_TASKS: readonly CreateTaskInput[] = [
  taskByTitle("Patch session token leak in password-reset flow"),
  taskByTitle("Migrate legacy billing cron to event-driven pipeline"),
  taskByTitle("Fix memory leak in the image-processing worker"),
  taskByTitle("Export monthly revenue report as CSV"),
  taskByTitle("Add end-to-end search indexing for the product catalog"),
  taskByTitle("Real-time presence indicators for the workspace"),
  taskByTitle("Stripe checkout retry handling"),
  taskByTitle("Notification digest with per-user preferences"),
];

export function pickRandomTask(
  exclude: readonly string[] = [],
  rng: () => number = Math.random,
): CreateTaskInput {
  const excluded = new Set(exclude);
  const pool = TASK_BACKLOG.filter((task) => !excluded.has(task.title));
  const source = pool.length > 0 ? pool : TASK_BACKLOG;
  const index = Math.min(
    source.length - 1,
    Math.floor(rng() * source.length),
  );
  return cloneInput(source[index]);
}

export const TASK_SUGGESTIONS: readonly string[] = [
  DEMO_TASK.title,
  "Fix memory leak in the image-processing worker",
  "Add end-to-end search indexing for the product catalog",
  "Real-time presence indicators for the workspace",
  "Stripe checkout retry handling",
];
