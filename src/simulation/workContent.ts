/**
 * Canned work content. The simulation matches the task text against the first
 * template whose pattern hits, so a real backend can keep sending plain task
 * titles without changing the UI or the workflow.
 */
export interface WorkTemplate {
  id: string;
  match: RegExp;
  subtasks: readonly string[];
  findings: readonly string[];
  tests: readonly string[];
  reviewNotes: readonly string[];
}

export const WORK_TEMPLATES: readonly WorkTemplate[] = [
  {
    id: "auth",
    match: /\b(auth|authentication|jwt|oauth|login|password|credential|session|token)\b/i,
    subtasks: [
      "Define user + credential schema",
      "POST /auth/register with password hashing",
      "POST /auth/login issuing JWT access token",
      "Refresh-token rotation endpoint",
      "Auth middleware for protected routes",
      "Rate-limit login attempts",
    ],
    findings: [
      "Short-lived access tokens (15 min) + rotating refresh tokens",
      "Hash passwords with argon2id; never log credentials",
      "Sign tokens with asymmetric keys to allow key rotation",
    ],
    tests: [
      "rejects expired access token",
      "rotates refresh token on replay",
      "locks login after five failed attempts",
    ],
    reviewNotes: [
      "Access tokens should carry only the scopes the route needs.",
      "Refresh-token rotation must revoke the whole token family on replay.",
    ],
  },
  {
    id: "search",
    match: /\b(search|index|indexing|catalog|ranking|full-text)\b/i,
    subtasks: [
      "Define the search document schema",
      "Backfill the index from the primary store",
      "Add incremental indexing on writes",
      "Rank exact title matches above body matches",
      "Expose faceted filters and pagination",
      "Write the reindex runbook",
    ],
    findings: [
      "Postgres full-text search is enough below 2M documents; avoid a new service for now.",
      "Index writes must be debounced or bulk upserts will dominate database load.",
      "Tie-break equal scores by recency so pagination stays stable.",
    ],
    tests: [
      "search returns a newly indexed document within one second",
      "filters and pagination keep a stable order",
      "deleted documents disappear from results",
    ],
    reviewNotes: [
      "Backfill in batches with a resumable cursor.",
      "A failed index write must not block the user-facing transaction.",
    ],
  },
  {
    id: "realtime",
    match: /\b(realtime|real-time|websocket|presence|socket|live update)\b/i,
    subtasks: [
      "Define presence channels and membership events",
      "Authenticate the socket before subscribing",
      "Broadcast joins and leaves with debounce",
      "Handle reconnects without duplicate members",
      "Add heartbeat and stale-session cleanup",
    ],
    findings: [
      "Presence is ephemeral; do not persist it as a source of truth.",
      "A reconnect storm after deploy needs jittered client backoff.",
      "Sticky sessions are required unless the broker fans out across nodes.",
    ],
    tests: [
      "presence joins are visible to peers",
      "reconnect does not duplicate a member",
      "stale sessions expire after the heartbeat window",
    ],
    reviewNotes: [
      "Cap fan-out per room so one noisy channel cannot starve others.",
      "Authenticate the socket before it can subscribe to any channel.",
    ],
  },
  {
    id: "migration",
    match: /\b(migration|migrate|database|schema|backfill|etl)\b/i,
    subtasks: [
      "Inventory every consumer of the legacy cron",
      "Design the event schema and topics",
      "Run the new pipeline in shadow mode",
      "Backfill historical events with a checkpoint",
      "Cut consumers over behind a flag",
      "Add alerting for lag and dead letters",
    ],
    findings: [
      "Shadow mode needs a diff report, not just an absence of errors.",
      "The backfill must be idempotent and restartable from its checkpoint.",
      "Dead-letter handling is part of the cutover, not a follow-up.",
    ],
    tests: [
      "backfill resumes from the last checkpoint",
      "a repeated event does not duplicate a charge",
      "the cutover flag routes traffic to the new pipeline",
    ],
    reviewNotes: [
      "Keep the cron writer alive until consumers confirm parity.",
      "Dead-letter alarms must page before the retry budget runs out.",
    ],
  },
  {
    id: "payments",
    match: /\b(payments?|billing|stripe|invoice|checkout|refund)\b/i,
    subtasks: [
      "Model payment intents and retry state",
      "Add idempotency keys to charge creation",
      "Handle card declines with a typed error",
      "Verify webhook signatures",
      "Reconcile refunds against the ledger",
      "Add dunning retries for failed renewals",
    ],
    findings: [
      "Stripe retries webhooks for up to three days; handlers must be idempotent.",
      "Card declines and network failures need different retry policies.",
      "Store amounts in minor units, never as floats.",
    ],
    tests: [
      "charges are idempotent for the same key",
      "declined cards surface a recoverable error",
      "a webhook replay does not double-credit a customer",
    ],
    reviewNotes: [
      "Persist the idempotency key before calling the payment provider.",
      "Never log full PAN or CVC values, even at debug level.",
    ],
  },
  {
    id: "i18n",
    match: /\b(i18n|localis\w*|localiz\w*|translation|locale|internationalis\w*)\b/i,
    subtasks: [
      "Extract user-facing strings into message catalogs",
      "Negotiate the locale from the request",
      "Translate the onboarding flow for five markets",
      "Handle pluralisation and date formats",
      "Add a missing-key check to CI",
    ],
    findings: [
      "String concatenation breaks grammar in most languages; send full messages.",
      "Plural rules are language-specific and not a simple count check.",
      "Dates and numbers must follow the user's locale, not the server's.",
    ],
    tests: [
      "missing keys fall back to the default locale",
      "plural forms render correctly per locale",
      "locale negotiation honours the query and the header",
    ],
    reviewNotes: [
      "Keep message keys stable; renaming one silently breaks translations.",
      "Do not translate log lines or API error codes.",
    ],
  },
  {
    id: "notification",
    match: /\b(notifications?|email|digest|newsletter|alerting)\b/i,
    subtasks: [
      "Model per-user channel preferences",
      "Render the digest from a shared template",
      "Batch notifications into a daily window",
      "Throttle per-user sends and coalesce duplicates",
      "Add unsubscribe links that work without login",
    ],
    findings: [
      "Digest batching must respect each user's timezone.",
      "Email clients strip most CSS; use a table layout and inline styles.",
      "Unsubscribe must not require a session or users will report spam.",
    ],
    tests: [
      "the digest respects the user's timezone window",
      "duplicate events coalesce into one email",
      "the unsubscribe link disables delivery immediately",
    ],
    reviewNotes: [
      "Send once and retry on provider failure; never fan out duplicate sends.",
      "Keep the plain-text part of every email meaningful.",
    ],
  },
  {
    id: "performance",
    match: /\b(performance|latency|memory|leak|slow|soak|throughput)\b/i,
    subtasks: [
      "Reproduce the leak with heap snapshots",
      "Identify retained buffers in the worker pool",
      "Release image buffers on every path, including errors",
      "Bound the worker queue and add backpressure",
      "Add a soak test to CI",
    ],
    findings: [
      "The leak is a retained buffer per job, not a growing cache.",
      "Unbounded queues turn a slow consumer into an out-of-memory crash.",
      "Heap snapshots before and after a 10k-job soak make the fix verifiable.",
    ],
    tests: [
      "worker memory stays flat over 10k jobs",
      "a failed job releases its buffer",
      "queue depth stays bounded under load",
    ],
    reviewNotes: [
      "Free buffers in a finally block, not only on success.",
      "Backpressure must surface as a 429, not an unbounded queue.",
    ],
  },
  {
    id: "deploy",
    match: /\b(deploy|deployment|canary|kubernetes|k8s|ci|smoke test)\b/i,
    subtasks: [
      "Define canary stages and error budgets",
      "Add health checks to the gateway",
      "Automate rollback on error-rate regression",
      "Gate promotion on integration smoke tests",
      "Document the on-call runbook",
    ],
    findings: [
      "A canary without a rollback trigger is just a slow full rollout.",
      "Compare error rate against the baseline window, not a fixed threshold.",
      "Smoke tests must run against the canary slice, not the main pool.",
    ],
    tests: [
      "promotion stops when the canary error rate regresses",
      "rollback restores the previous revision",
      "smoke tests gate the final promotion",
    ],
    reviewNotes: [
      "Rollback must not depend on the same pipeline that is failing.",
      "Log the canary decision together with the metrics that triggered it.",
    ],
  },
  {
    id: "mobile",
    match: /\b(mobile|offline|sync|ios|android|field technician)\b/i,
    subtasks: [
      "Define the local record and change log",
      "Queue mutations while offline",
      "Reconcile conflicts with last-write-wins and tombstones",
      "Sync on reconnect with exponential backoff",
      "Add a manual sync indicator",
    ],
    findings: [
      "Without tombstones, deletes resurrect on the next sync.",
      "Battery-friendly sync means batching and backing off, not polling.",
      "Server clocks are authoritative; client timestamps only break ties.",
    ],
    tests: [
      "offline edits sync after reconnect",
      "deleted records do not reappear",
      "a conflict resolves deterministically",
    ],
    reviewNotes: [
      "Never block the UI thread while applying a sync batch.",
      "Version the local schema so upgrades can migrate the change log.",
    ],
  },
  {
    id: "export",
    match: /\b(export|csv|parquet|report|download)\b/i,
    subtasks: [
      "Define the report schema and column contract",
      "Stream rows instead of building an array",
      "Encode CSV with correct quoting and UTF-8",
      "Add a signed download link with expiry",
      "Cover empty and very large result sets",
    ],
    findings: [
      "Streaming keeps memory flat for reports over a million rows.",
      "CSV quoting must handle commas, quotes and newlines inside fields.",
      "Signed links should expire quickly and never expose object keys.",
    ],
    tests: [
      "export streams a million rows without buffering",
      "fields with commas and quotes round-trip",
      "an empty result set produces a header-only file",
    ],
    reviewNotes: [
      "Cap concurrent exports per account.",
      "Set Content-Disposition explicitly so the file name survives proxies.",
    ],
  },
  {
    id: "ai",
    match: /\b(ai|llm|summar\w*|prompt|inference|support thread)\b/i,
    subtasks: [
      "Define the summary prompt and output schema",
      "Chunk long threads with overlap",
      "Redact personal data before the model call",
      "Cache summaries by thread revision",
      "Add a confidence and fallback path",
    ],
    findings: [
      "Summaries must cite the thread revision they were generated from.",
      "Chunk overlap prevents a reply from being cut off mid-context.",
      "Redaction has to happen before the request leaves the service.",
    ],
    tests: [
      "a long thread is summarised within the token budget",
      "PII is redacted before the provider call",
      "an unchanged thread reuses the cached summary",
    ],
    reviewNotes: [
      "Treat model output as untrusted input and validate the schema.",
      "Keep a deterministic fallback when the provider is unavailable.",
    ],
  },
  {
    id: "security",
    match: /\b(rate[- ]limit\w*|rate limiting|security|sso|csrf|xss|vulnerabilit\w*|audit)\b/i,
    subtasks: [
      "Add per-IP and per-account rate limits",
      "Return 429 with a Retry-After header",
      "Validate the SSO callback state and nonce",
      "Pin the callback redirect to registered origins",
      "Add audit events for lockouts",
    ],
    findings: [
      "Rate-limit state must be shared across instances or the limit is per pod.",
      "An unvalidated SSO state parameter enables login CSRF.",
      "Redirect allowlists must compare normalised origins, not prefixes.",
    ],
    tests: [
      "the sixth login attempt is rate limited",
      "a replayed SSO state is rejected",
      "an unregistered redirect URI is refused",
    ],
    reviewNotes: [
      "Fail closed when the rate-limit store is unavailable.",
      "Never echo the raw state parameter in error responses.",
    ],
  },
  {
    id: "api",
    match: /\b(api|endpoints?|rest|crud|graphql|webhook)\b/i,
    subtasks: [
      "Define request and response schemas",
      "Add pagination with a stable cursor",
      "Enforce authorization on every route",
      "Return consistent error envelopes",
      "Add contract tests for the public routes",
    ],
    findings: [
      "Offset pagination drifts under writes; use a cursor.",
      "Error envelopes need a stable code the client can branch on.",
      "Authorization belongs in the handler, not only in the router.",
    ],
    tests: [
      "cursor pagination returns every record once",
      "a forbidden request returns 403 with a stable code",
      "invalid payloads return field-level errors",
    ],
    reviewNotes: [
      "Do not leak internal error strings to clients.",
      "Keep the OpenAPI spec in the same change as the handler.",
    ],
  },
  {
    id: "ui",
    match: /\b(ui|ux|dashboard|component|design system|frontend)\b/i,
    subtasks: [
      "Audit the dashboard for inconsistent spacing",
      "Extract shared card and table primitives",
      "Add loading, empty and error states",
      "Verify keyboard focus and contrast",
      "Document the component variants",
    ],
    findings: [
      "Most visual drift comes from ad-hoc spacing, not missing components.",
      "Every async panel needs an empty and an error state, not just a spinner.",
      "Table rows need a visible focus ring for keyboard users.",
    ],
    tests: [
      "cards render the empty state without data",
      "focus order follows the visual order",
      "tables stay readable at 390px width",
    ],
    reviewNotes: [
      "Prefer semantic tokens over one-off hex values.",
      "Do not hide critical actions behind hover-only affordances.",
    ],
  },
];

export const GENERIC_TEMPLATE: WorkTemplate = {
  id: "generic",
  match: /.*/,
  subtasks: [
    "Clarify acceptance criteria with the requester",
    "Map the affected code paths",
    "Implement the change behind a flag",
    "Add tests for the happy and failure paths",
    "Write rollout notes and rollback steps",
  ],
  findings: [
    "Start with the smallest change that satisfies the acceptance criteria.",
    "A flag keeps the rollout reversible without a redeploy.",
    "Tests should cover the failure path, not only the happy path.",
  ],
  tests: [
    "the feature works for the primary flow",
    "invalid input returns a clear error",
    "the flag disables the change cleanly",
  ],
  reviewNotes: [
    "Keep the change reviewable; split unrelated refactors out.",
    "Document the rollout and rollback steps in the pull request.",
  ],
};

export function matchWorkTemplate(text: string): WorkTemplate {
  for (const template of WORK_TEMPLATES) {
    if (template.match.test(text)) return template;
  }
  return GENERIC_TEMPLATE;
}

/** Truncates a title with an ellipsis for speech and activity lines. */
export function shortTitle(title: string, max = 42): string {
  const trimmed = title.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, Math.max(0, max - 1)).trimEnd()}\u2026`;
}
