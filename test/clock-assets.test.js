import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clockAssets } from "../server/clock-assets.mjs";

test("exposes only curated clock theme assets that exist", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ak-clock-assets-"));
  const directory = path.join(root, "[uc]common");
  fs.mkdirSync(directory, { recursive: true });
  const asset = path.join(directory, "icon_time.png");
  fs.writeFileSync(asset, "png");
  assert.deepEqual(clockAssets(root), { "rhodes-time": asset });
  fs.rmSync(root, { recursive: true, force: true });
});
