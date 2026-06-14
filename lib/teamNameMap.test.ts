/**
 * teamNameMap sanity — map values are well-formed and resolveCanonical applies
 * the exception map, falls back to identity, and rejects unknown names.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { TEAM_NAME_MAP, resolveCanonical } from "./teamNameMap";

test("every map value is a non-empty trimmed string", () => {
  for (const [key, value] of Object.entries(TEAM_NAME_MAP)) {
    assert.equal(typeof value, "string", `${key} maps to a non-string`);
    assert.ok(value.length > 0, `${key} maps to an empty string`);
    assert.equal(value, value.trim(), `${key} maps to an untrimmed value`);
  }
});

test("resolveCanonical applies the exception map", () => {
  const canonical = new Set(["IR Iran", "Rep. of Korea", "Bosnia/Herzeg.", "Spain"]);
  assert.equal(resolveCanonical("Iran", canonical), "IR Iran");
  assert.equal(resolveCanonical("South Korea", canonical), "Rep. of Korea");
  assert.equal(resolveCanonical("Bosnia and Herzegovina", canonical), "Bosnia/Herzeg.");
});

test("resolveCanonical falls back to identity for already-canonical names", () => {
  const canonical = new Set(["Spain", "Brazil"]);
  assert.equal(resolveCanonical("Spain", canonical), "Spain");
  assert.equal(resolveCanonical("Brazil", canonical), "Brazil");
});

test("resolveCanonical returns null for unknown or empty names", () => {
  const canonical = new Set(["Spain"]);
  assert.equal(resolveCanonical("Atlantis", canonical), null);
  assert.equal(resolveCanonical(null, canonical), null);
  // Mapped value not present in the canonical set → null, never coerced.
  assert.equal(resolveCanonical("Iran", canonical), null);
});
