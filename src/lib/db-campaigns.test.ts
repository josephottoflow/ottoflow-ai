/**
 * Unit tests — Campaign Workspace data helpers (pure logic).
 * Runner: Node's built-in test runner via tsx (no new dependency).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  deriveCampaignMetrics,
  campaignDisplayName,
  filterCampaigns,
  sortCampaigns,
  campaignTimeline,
  CAMPAIGN_LIFECYCLE,
} from "./db-campaigns";
import type { DbCampaign } from "./types";

function campaign(over: Partial<DbCampaign>): DbCampaign {
  return {
    id: over.id ?? "c1",
    user_id: "u1",
    brand_id: "b1",
    title: null,
    prompt: "a prompt",
    platform: "linkedin",
    status: "planning",
    strategy: null,
    qa: null,
    asset_count: 0,
    error: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...over,
  };
}

test("deriveCampaignMetrics buckets content statuses + computes completion", () => {
  const m = deriveCampaignMetrics({
    researchIdeaCount: 3,
    contentStatuses: ["draft", "in_review", "approved", "scheduled", "published", "published", "rejected"],
    creativeCount: 5,
  });
  assert.equal(m.researchIdeas, 3);
  assert.equal(m.drafts, 2); // draft + in_review
  assert.equal(m.approved, 1);
  assert.equal(m.scheduled, 1);
  assert.equal(m.published, 2);
  assert.equal(m.creatives, 5);
  assert.equal(m.totalContent, 7);
  assert.equal(m.completionPct, Math.round((2 / 7) * 100)); // 29
});

test("deriveCampaignMetrics with no content → zeros, 0% (no divide-by-zero)", () => {
  const m = deriveCampaignMetrics({ researchIdeaCount: 0, contentStatuses: [], creativeCount: 0 });
  assert.equal(m.totalContent, 0);
  assert.equal(m.completionPct, 0);
});

test("campaignDisplayName prefers name → title → prompt", () => {
  assert.equal(campaignDisplayName({ name: "Launch", title: "T", prompt: "P" }), "Launch");
  assert.equal(campaignDisplayName({ name: null, title: "T", prompt: "P" }), "T");
  assert.equal(campaignDisplayName({ name: "  ", title: null, prompt: "P" }), "P");
  assert.equal(campaignDisplayName({ name: null, title: null, prompt: "" }), "Untitled campaign");
});

test("filterCampaigns hides archived by default, respects favorite/status/tag/q", () => {
  const list = [
    campaign({ id: "a", name: "Alpha", tags: ["q3"], is_favorite: true, status: "live" }),
    campaign({ id: "b", name: "Beta", is_archived: true }),
    campaign({ id: "c", name: "Gamma", status: "planning" }),
  ];
  assert.deepEqual(filterCampaigns(list).map((c) => c.id), ["a", "c"]); // archived hidden
  assert.deepEqual(filterCampaigns(list, { archived: true }).map((c) => c.id), ["b"]);
  assert.deepEqual(filterCampaigns(list, { favorite: true }).map((c) => c.id), ["a"]);
  assert.deepEqual(filterCampaigns(list, { status: "planning" }).map((c) => c.id), ["c"]);
  assert.deepEqual(filterCampaigns(list, { tag: "q3" }).map((c) => c.id), ["a"]);
  assert.deepEqual(filterCampaigns(list, { q: "gamma" }).map((c) => c.id), ["c"]);
});

test("sortCampaigns orders by name / priority / recent", () => {
  const list = [
    campaign({ id: "a", name: "Beta", priority: "low", updated_at: "2026-01-02T00:00:00Z" }),
    campaign({ id: "b", name: "Alpha", priority: "urgent", updated_at: "2026-01-03T00:00:00Z" }),
  ];
  assert.deepEqual(sortCampaigns(list, "name").map((c) => c.id), ["b", "a"]);
  assert.deepEqual(sortCampaigns(list, "priority").map((c) => c.id), ["b", "a"]);
  assert.deepEqual(sortCampaigns(list, "recent").map((c) => c.id), ["b", "a"]);
});

test("campaignTimeline advances by status AND relationship metrics", () => {
  const base = deriveCampaignMetrics({ researchIdeaCount: 0, contentStatuses: [], creativeCount: 0 });
  const t0 = campaignTimeline("planning", base);
  assert.equal(t0.length, CAMPAIGN_LIFECYCLE.length);
  assert.equal(t0[0].active, true);
  assert.equal(t0.every((s) => !s.done), true);

  // published content pushes the timeline to 'completed' even if status lags
  const done = deriveCampaignMetrics({ researchIdeaCount: 2, contentStatuses: ["published"], creativeCount: 1 });
  const t1 = campaignTimeline("in_progress", done);
  assert.equal(t1[t1.length - 1].active, true); // completed is the reached stage
  assert.equal(t1[0].done, true);
});
