import assert from "node:assert/strict";
import test from "node:test";
import { getTeamFlag } from "./flags";

test("canonical workbook teams with known missing flags map to flag glyphs", () => {
  for (const team of [
    "Cape Verde",
    "Haiti",
    "Iraq",
    "Jordan",
    "Scotland",
    "DR Congo",
    "Ivory Coast",
    "Uzbekistan",
  ]) {
    assert.notEqual(getTeamFlag(team), "⚽", `${team} should not fall back to soccer ball`);
  }
});
