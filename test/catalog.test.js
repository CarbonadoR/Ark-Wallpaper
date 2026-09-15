import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { scanResources, virtualAtlas } from "../server/catalog.mjs";

test("scanner pairs differently named skeletons within one resource directory", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ak-viewer-"));
  const directory = path.join(root, "char_test_2", "DynIllust", "dyn_test");
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "model.atlas"), "\ntexture.png\nsize: 1,1\nformat: RGBA8888\nfilter: Linear,Linear\nrepeat: none\n");
  fs.writeFileSync(path.join(directory, "texture.png"), "x");
  fs.writeFileSync(path.join(directory, "model2.skel"), Buffer.from([0, 4, 51, 46, 56]));
  const result = scanResources(root);
  assert.equal(result.models.length, 1);
  assert.equal(result.models[0].groupId, "char_test_2");
  assert.equal(result.models[0].kind, "DynIllust");
  fs.rmSync(root, { recursive: true, force: true });
});

test("virtual atlas aliases fragment-sensitive and multi-page texture names", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ak-atlas-"));
  const atlasPath = path.join(root, "model.atlas");
  fs.writeFileSync(atlasPath, "character#2.png\nsize: 1,1\n\ncharacter#22.png\nsize: 1,1\n");
  const output = virtualAtlas({ atlasPath, pages: ["character#2.png", "character#22.png"] });
  assert.match(output, /^texture-0\.png/m);
  assert.match(output, /^texture-1\.png/m);
  assert.doesNotMatch(output, /character#/);
  fs.rmSync(root, { recursive: true, force: true });
});
