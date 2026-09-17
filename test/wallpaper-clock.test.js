import test from "node:test";
import assert from "node:assert/strict";
import { clockPointerTilt, moveWallpaperClock, normalizeWallpaperClock, wallpaperClockFromSearch } from "../src/wallpaper-clock.js";

test("normalizes desktop clock settings", () => {
  assert.deepEqual(normalizeWallpaperClock({ enabled: "0", theme: "unknown", x: 200, y: -20, locked: "false" }), {
    enabled: false,
    theme: "rhodes",
    scale: 1,
    x: 96,
    y: 6,
    locked: false,
    perspective: "none",
    pointerPerspective: false,
  });
});

test("reads desktop clock settings from wallpaper URL", () => {
  assert.deepEqual(wallpaperClockFromSearch(new URLSearchParams("clock=1&clockTheme=monochrome&clockScale=1.4&clockX=24.5&clockY=71&clockLocked=0&clockPerspective=right&clockPointerPerspective=1")), {
    enabled: true,
    theme: "monochrome",
    scale: 1.4,
    x: 24.5,
    y: 71,
    locked: false,
    perspective: "right",
    pointerPerspective: true,
  });
});

test("uses a visible top-right default position when URL coordinates are absent", () => {
  assert.deepEqual(wallpaperClockFromSearch(new URLSearchParams()), {
    enabled: true,
    theme: "rhodes",
    scale: 1,
    x: 82,
    y: 18,
    locked: true,
    perspective: "none",
    pointerPerspective: false,
  });
});

test("moves the desktop clock in viewport-relative coordinates and clamps it on screen", () => {
  assert.deepEqual(moveWallpaperClock({ enabled: true, theme: "rhodes", scale: 1.25, x: 50, y: 50, locked: false, perspective: "left" }, {
    deltaX: 200,
    deltaY: -100,
    viewportWidth: 1000,
    viewportHeight: 500,
  }), { enabled: true, theme: "rhodes", scale: 1.25, x: 70, y: 30, locked: false, perspective: "left", pointerPerspective: false });
  assert.equal(moveWallpaperClock({ x: 95, y: 50 }, { deltaX: 1000, viewportWidth: 1000 }).x, 96);
});

test("keeps legacy boolean perspective settings as left tilt", () => {
  assert.equal(normalizeWallpaperClock({ perspective: true }).perspective, "left");
  assert.equal(normalizeWallpaperClock({ perspective: false }).perspective, "none");
  assert.equal(normalizeWallpaperClock({ perspective: "none" }).perspective, "none");
});

test("clamps desktop clock size", () => {
  assert.equal(normalizeWallpaperClock({ scale: 0.1 }).scale, 0.5);
  assert.equal(normalizeWallpaperClock({ scale: 3 }).scale, 2);
});

test("aims the clock plane toward the pointer and clamps extreme angles", () => {
  assert.deepEqual(clockPointerTilt({ pointerX: 500, pointerY: 300, clockX: 50, clockY: 50, viewportWidth: 1000, viewportHeight: 600 }), { rotateX: 0, rotateY: 0 });
  const upperRight = clockPointerTilt({ pointerX: 900, pointerY: 40, clockX: 50, clockY: 50, viewportWidth: 1000, viewportHeight: 600 });
  assert.equal(upperRight.rotateX > 0, true);
  assert.equal(upperRight.rotateY > 0, true);
  const lowerLeft = clockPointerTilt({ pointerX: -10000, pointerY: 10000, clockX: 50, clockY: 50, viewportWidth: 1000, viewportHeight: 600 });
  assert.deepEqual(lowerLeft, { rotateX: -9, rotateY: -13 });
});
