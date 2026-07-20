/**
 * Unit tests — QA report-only scaffolding.
 *
 * Locks the four guarantees the report-only pathway must have before any real
 * scoring is wired in: OFF by default, gated correctly, never blocking, never
 * throwing (fail-safe).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAdvisoryReport, maybeRunAdvisoryQa, type AdvisoryQaReport } from "./qa-report";

const INPUT = { profile: "legacy", frame: { width: 1080, height: 1920 } };

test("inert by default — returns null with an empty environment", () => {
  assert.equal(maybeRunAdvisoryQa(INPUT, undefined, {}), null);
});

test("gated — master gate alone does not enable it", () => {
  assert.equal(
    maybeRunAdvisoryQa(INPUT, undefined, { CREATIVE_OS_ENABLED: "true" }),
    null,
  );
});

test("active only with master gate + report_only", () => {
  const report = maybeRunAdvisoryQa(INPUT, undefined, {
    CREATIVE_OS_ENABLED: "true",
    CREATIVE_OS_QA_MODE: "report_only",
  });
  assert.ok(report, "expected a report when report-only is active");
  assert.equal(report.mode, "report_only");
  assert.equal(report.blocking, false);
  assert.equal(report.profile, "legacy");
  assert.deepEqual(report.dimensions, []); // scaffold — QA Engine populates later
});

test("never blocks — the report's blocking flag is always false", () => {
  const report = buildAdvisoryReport(INPUT);
  assert.equal(report.blocking, false);
});

test("sink is called when active, and not when inactive", () => {
  const seen: AdvisoryQaReport[] = [];
  const sink = (r: AdvisoryQaReport) => seen.push(r);

  maybeRunAdvisoryQa(INPUT, sink, {}); // inactive
  assert.equal(seen.length, 0);

  maybeRunAdvisoryQa(INPUT, sink, {
    CREATIVE_OS_ENABLED: "true",
    CREATIVE_OS_QA_MODE: "report_only",
  });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].blocking, false);
});

test("fail-safe — a throwing sink never propagates", () => {
  const badSink = () => {
    throw new Error("telemetry blew up");
  };
  const active = { CREATIVE_OS_ENABLED: "true", CREATIVE_OS_QA_MODE: "report_only" };
  // Must not throw; still returns the report.
  const report = maybeRunAdvisoryQa(INPUT, badSink, active);
  assert.ok(report);
  assert.equal(report.blocking, false);
});

test("buildAdvisoryReport is pure — identical output for identical input", () => {
  assert.deepEqual(buildAdvisoryReport(INPUT), buildAdvisoryReport(INPUT));
});
