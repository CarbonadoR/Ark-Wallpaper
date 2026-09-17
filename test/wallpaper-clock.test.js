import test from "node:test";
import assert from "node:assert/strict";
import { moveWallpaperClock, normalizeWallpaperClock, wallpaperClockFromSearch } from "../src/wallpaper-clock.js";

test("normalizes desktop clock settings", () => {
  assert.deepEqual(normalizeWallpaperClock({ enabled: "0", theme: "unknown", x: 200, y: -20, locked: "false" }), {
    enabled: false,
    theme: "rhodes",
    x: 96,
    y: 6,
    locked: false,
  });
});

test("reads desktop clock settings from wallpaper URL", () => {
  assert.deepEqual(wallpaperClockFromSearch(new URLSearchParams("clock=1&clockTheme=lonetrail&clockX=24.5&clockY=71&clockLocked=0")), {
    enabled: true,
    theme: "lonetrail",
    x: 24.5,
    y: 71,
    locked: false,
  });
});

test("uses a visible top-right default position when URL coordinates are absent", () => {
  assert.deepEqual(wallpaperClockFromSearch(new URLSearchParams()), {
    enabled: true,
    theme: "rhodes",
    x: 82,
    y: 18,
    locked: true,
  });
});

test("moves the desktop clock in viewport-relative coordinates and clamps it on screen", () => {
  assert.deepEqual(moveWallpaperClock({ enabled: true, theme: "rhodes", x: 50, y: 50, locked: false }, {
    deltaX: 200,
    deltaY: -100,
    viewportWidth: 1000,
    viewportHeight: 500,
  }), { enabled: true, theme: "rhodes", x: 70, y: 30, locked: false });
  assert.equal(moveWallpaperClock({ x: 95, y: 50 }, { deltaX: 1000, viewportWidth: 1000 }).x, 96);
});
