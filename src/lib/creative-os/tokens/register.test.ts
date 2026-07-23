/**
 * Unit tests — Register token dictionary.
 * Locks the 13-register catalogue: completeness, in-range dials, valid caption
 * modes, and the temperature ordering that makes registers distinct (fitness
 * fastest/punchiest, luxury slowest with the most air and least emphasis).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { REGISTERS, REGISTER_IDS, type RegisterId } from "./register";
import { CAPTION_MODES } from "./caption";

test("all 13 registers are present and self-consistent", () => {
  assert.equal(REGISTER_IDS.length, 13);
  for (const id of REGISTER_IDS) {
    const r = REGISTERS[id];
    assert.ok(r, `missing register ${id}`);
    assert.equal(r.id, id, `${id} id mismatch`);
  }
});

test("dials are in plausible ranges", () => {
  for (const id of REGISTER_IDS) {
    const r = REGISTERS[id];
    assert.ok(r.paceMult >= 0.5 && r.paceMult <= 2, `${id} paceMult`);
    assert.ok(r.motionMult >= 0.4 && r.motionMult <= 2, `${id} motionMult`);
    assert.ok(r.spaceMult >= 0.5 && r.spaceMult <= 2, `${id} spaceMult`);
    assert.ok(r.emphasis >= 1 && r.emphasis <= 5, `${id} emphasis`);
    assert.ok(r.passThreshold >= 78 && r.passThreshold <= 90, `${id} threshold`);
  }
});

test("every register's captionMode is a real caption personality", () => {
  for (const id of REGISTER_IDS) {
    assert.ok((CAPTION_MODES as string[]).includes(REGISTERS[id].captionMode), `${id} bad captionMode`);
  }
});

test("temperature ordering: fitness fastest/punchiest, luxury slowest/airiest/quietest", () => {
  assert.ok(REGISTERS.fitness.paceMult > REGISTERS.luxury.paceMult, "fitness faster than luxury");
  assert.ok(REGISTERS.luxury.spaceMult > REGISTERS.fitness.spaceMult, "luxury has more air");
  assert.equal(REGISTERS.luxury.emphasis, 1, "luxury minimal emphasis");
  assert.ok(REGISTERS.fitness.emphasis >= 4, "fitness strong emphasis");
});

test("registers with a dedicated caption personality use it", () => {
  assert.equal(REGISTERS.luxury.captionMode, "luxury");
  assert.equal(REGISTERS.founder.captionMode, "founder");
  assert.equal(REGISTERS.documentary.captionMode, "documentary");
  assert.equal(REGISTERS.ugc.captionMode, "ugc");
});
