import test from "node:test";
import assert from "node:assert/strict";
import { calculateLayout, layoutFromSearch, normalizeLayout } from "../src/layout.js";

test("layout supports wallpaper fill modes", () => {
  const base = { screenWidth: 1920, screenHeight: 1080, contentWidth: 1000, contentHeight: 1000 };
  assert.deepEqual(calculateLayout({ ...base, fit: "contain" }), { scaleX: 1.08, scaleY: 1.08, x: 960, y: 540 });
  assert.deepEqual(calculateLayout({ ...base, fit: "cover" }), { scaleX: 1.92, scaleY: 1.92, x: 960, y: 540 });
  assert.deepEqual(calculateLayout({ ...base, fit: "stretch" }), { scaleX: 1.92, scaleY: 1.08, x: 960, y: 540 });
});

test("layout clamps values and defaults to locked", () => {
  assert.deepEqual(normalizeLayout({ scale: 8, offsetX: -500, offsetY: 500 }), { fit: "contain", scale: 3, offsetX: -100, offsetY: 100, locked: true });
  assert.equal(layoutFromSearch(new URLSearchParams("locked=0")).locked, false);
});
