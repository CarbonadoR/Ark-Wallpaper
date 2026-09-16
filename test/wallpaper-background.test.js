import test from "node:test";
import assert from "node:assert/strict";
import { normalizeWallpaperBackground, wallpaperBackgroundFromSearch } from "../src/wallpaper-background.js";

test("normalizes wallpaper colors and reserved background sources", () => {
  assert.deepEqual(normalizeWallpaperBackground({ color: "#1af", imageUrl: "/api/background.png", spineId: " backdrop " }), {
    color: "#11AAFF",
    imageUrl: "/api/background.png",
    imageUrls: ["/api/background.png"],
    spineId: "backdrop",
  });
  assert.deepEqual(normalizeWallpaperBackground({ color: "invalid", imageUrl: "javascript:alert(1)" }), {
    color: "#000000",
    imageUrl: "",
    imageUrls: [],
    spineId: "",
  });
});

test("reads wallpaper background settings from query parameters", () => {
  assert.deepEqual(wallpaperBackgroundFromSearch(new URLSearchParams("background=%23203040&backgroundImage=%2Fbg.webp&backgroundSpine=scene-1")), {
    color: "#203040",
    imageUrl: "/bg.webp",
    imageUrls: ["/bg.webp"],
    spineId: "scene-1",
  });
});

test("reads a two-part high-resolution panorama", () => {
  assert.deepEqual(wallpaperBackgroundFromSearch(new URLSearchParams("backgroundImageLeft=%2Fleft.png&backgroundImageRight=%2Fright.png")), {
    color: "#000000",
    imageUrl: "",
    imageUrls: ["/left.png", "/right.png"],
    spineId: "",
  });
});
