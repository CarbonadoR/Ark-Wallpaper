import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { publicBackgrounds, scanBackgrounds } from "../server/backgrounds.mjs";

test("scans only safe home background directories with matching main images", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ak-backgrounds-"));
  fs.mkdirSync(path.join(root, "bg_laterano_1"));
  fs.writeFileSync(path.join(root, "bg_laterano_1", "bg_laterano_1.png"), "image");
  fs.writeFileSync(path.join(root, "bg_laterano_1", "bg_laterano_1_left.png"), "left");
  fs.writeFileSync(path.join(root, "bg_laterano_1", "bg_laterano_1_right.png"), "right");
  fs.mkdirSync(path.join(root, "missing_main"));
  fs.mkdirSync(path.join(root, "unsafe name"));
  fs.writeFileSync(path.join(root, "unsafe name", "unsafe name.png"), "image");

  const backgrounds = scanBackgrounds(root);
  assert.deepEqual(publicBackgrounds(backgrounds), [
    {
      id: "bg_laterano_1:hd",
      name: "laterano 1 · 高清",
      imageUrls: ["/api/backgrounds/bg_laterano_1/left", "/api/backgrounds/bg_laterano_1/right"],
    },
    {
      id: "bg_laterano_1:blur",
      name: "laterano 1 · 模糊",
      imageUrls: ["/api/backgrounds/bg_laterano_1/image"],
    },
  ]);
  fs.rmSync(root, { recursive: true, force: true });
});
