/**
 * Sprint §3 — create Sentry issue alert rules A/B/C via API.
 *
 * Replaces ~50 brittle UI clicks with 3 deterministic POSTs. Run once
 * with a Sentry auth token that has the `project:write` scope.
 *
 * Setup (one-time):
 *   1. Generate a Sentry auth token: https://ottoflow.sentry.io/settings/auth-tokens/
 *      Required scope: project:write
 *   2. Set SENTRY_AUTH_TOKEN in your shell (do NOT commit it):
 *      Bash:       export SENTRY_AUTH_TOKEN="sntrys_..."
 *      PowerShell: $env:SENTRY_AUTH_TOKEN = "sntrys_..."
 *   3. Run:
 *      npx tsx scripts/create-sentry-alert-rules.ts
 *
 * The script is idempotent on the Sentry side IF you delete prior runs first.
 * Sentry returns 400 if a rule with the same name exists.
 *
 * If you re-run after a failure: delete the partially-created rules in the
 * Sentry UI (https://ottoflow.sentry.io/alerts/rules/) before re-running.
 */

interface AlertRulePayload {
  name: string;
  environment: string;
  actionMatch: "all" | "any";
  filterMatch: "all" | "any";
  /** Action throttle in minutes (5 = max one alert per 5 min per issue) */
  frequency: number;
  /** Conditions that determine WHEN the rule evaluates. */
  conditions: Array<{ id: string }>;
  /**
   * Filters narrow which events match. Tag-based + frequency filters live here
   * in Sentry's modern rule model.
   */
  filters: Array<Record<string, unknown>>;
  /**
   * Actions to execute. Email-only for now — Slack can be added later via UI
   * once the Slack integration is wired in Sentry Settings → Integrations.
   */
  actions: Array<Record<string, unknown>>;
}

const SENTRY_HOST = "https://sentry.io";
const ORG_SLUG = "ottoflow";
const PROJECT_SLUG = "javascript-nextjs";

const RULES: AlertRulePayload[] = [
  // ─── Rule A — Video pipeline P0 burst ───────────────────────────────────────
  {
    name: "Video pipeline P0 — burst failure",
    environment: "production",
    actionMatch: "all", // trigger only when ALL conditions met (just one here)
    filterMatch: "any", // event matches if ANY filter fires (OR semantics for video.generate. + video.merge.)
    frequency: 5, // throttle: max one alert per 5 min per issue
    conditions: [
      {
        // Fire on every event creation in an existing-or-new issue.
        // The frequency filter below provides the burst-detection logic.
        id: "sentry.rules.conditions.first_seen_event.FirstSeenEventCondition",
      },
      {
        // ALSO fire on re-occurrence so we catch resolved-then-resurfaced issues.
        id: "sentry.rules.conditions.reappeared_event.ReappearedEventCondition",
      },
    ],
    filters: [
      {
        // tag fallback.label contains "video.generate."
        id: "sentry.rules.filters.tagged_event.TaggedEventFilter",
        key: "fallback.label",
        match: "co", // "contains"
        value: "video.generate.",
      },
      {
        // tag fallback.label contains "video.merge."
        id: "sentry.rules.filters.tagged_event.TaggedEventFilter",
        key: "fallback.label",
        match: "co",
        value: "video.merge.",
      },
      {
        // Issue frequency: >5 events in 5 minutes
        id: "sentry.rules.filters.event_frequency.EventFrequencyFilter",
        value: 5,
        interval: "5m",
      },
    ],
    actions: [
      {
        // Notify everyone subscribed to the issue (org default = owner email).
        id: "sentry.mail.actions.NotifyEmailAction",
        targetType: "IssueOwners",
        fallthroughType: "ActiveMembers",
      },
    ],
  },

  // ─── Rule B — Provider chain failure sustained ──────────────────────────────
  {
    name: "Provider chain failure — sustained",
    environment: "production",
    actionMatch: "all",
    filterMatch: "all",
    frequency: 60, // throttle: max one alert per 60 min per issue
    conditions: [
      {
        id: "sentry.rules.conditions.first_seen_event.FirstSeenEventCondition",
      },
      {
        id: "sentry.rules.conditions.reappeared_event.ReappearedEventCondition",
      },
    ],
    filters: [
      {
        // Exact match — tag fallback.label = "video-provider.scene_failed"
        id: "sentry.rules.filters.tagged_event.TaggedEventFilter",
        key: "fallback.label",
        match: "eq", // "equals"
        value: "video-provider.scene_failed",
      },
      {
        // > 10 events in 1 hour
        id: "sentry.rules.filters.event_frequency.EventFrequencyFilter",
        value: 10,
        interval: "1h",
      },
    ],
    actions: [
      {
        id: "sentry.mail.actions.NotifyEmailAction",
        targetType: "IssueOwners",
        fallthroughType: "ActiveMembers",
      },
    ],
  },

  // ─── Rule C — Worker fatal page-on-call ─────────────────────────────────────
  {
    name: "Worker fatal — page on-call",
    environment: "production",
    actionMatch: "all",
    filterMatch: "all",
    frequency: 1, // throttle: 1 min — no real throttle; every fatal pages
    conditions: [
      {
        // Fire on EVERY event capture, not just first-seen.
        id: "sentry.rules.conditions.every_event.EveryEventCondition",
      },
    ],
    filters: [
      {
        // tag runtime = "worker"
        id: "sentry.rules.filters.tagged_event.TaggedEventFilter",
        key: "runtime",
        match: "eq",
        value: "worker",
      },
      {
        // event.level = "fatal"
        id: "sentry.rules.filters.level.LevelFilter",
        level: "50", // 50 = fatal per Sentry's level enum (10 debug → 50 fatal)
        match: "eq",
      },
    ],
    actions: [
      {
        id: "sentry.mail.actions.NotifyEmailAction",
        targetType: "IssueOwners",
        fallthroughType: "ActiveMembers",
      },
    ],
  },
];

async function createRule(token: string, rule: AlertRulePayload): Promise<void> {
  const url = `${SENTRY_HOST}/api/0/projects/${ORG_SLUG}/${PROJECT_SLUG}/rules/`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(rule),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `Failed to create rule "${rule.name}": ${res.status} ${res.statusText}\n${body}`,
    );
  }

  const created = (await res.json()) as { id: string; name: string };
  console.log(`✓ Created rule #${created.id}: ${created.name}`);
}

async function main(): Promise<void> {
  const token = process.env.SENTRY_AUTH_TOKEN;
  if (!token) {
    console.error("ERROR: SENTRY_AUTH_TOKEN env var not set.");
    console.error(
      "Generate one at https://ottoflow.sentry.io/settings/auth-tokens/ (scope: project:write).",
    );
    process.exit(1);
  }

  console.log(`Creating ${RULES.length} Sentry alert rules in ${ORG_SLUG}/${PROJECT_SLUG}...`);

  let failures = 0;
  for (const rule of RULES) {
    try {
      await createRule(token, rule);
    } catch (err) {
      console.error(`✗ ${(err as Error).message}`);
      failures += 1;
    }
  }

  if (failures > 0) {
    console.error(`\n${failures}/${RULES.length} rules failed to create.`);
    console.error(
      "Check the error above. If 'rule with this name already exists', delete via Sentry UI before re-running.",
    );
    process.exit(1);
  }

  console.log(`\n✓ All ${RULES.length} rules created successfully.`);
  console.log("\nNext: trigger a test event via /api/debug/sentry-test to verify delivery.");
}

main().catch((err) => {
  console.error("Unhandled error:", err);
  process.exit(1);
});
