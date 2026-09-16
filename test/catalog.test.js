import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { scanResources, virtualAtlas } from "../server/catalog.mjs";

function pngHeader(width = 2, height = 3) {
  const result = Buffer.alloc(24);
  result.set([137, 80, 78, 71, 13, 10, 26, 10]);
  result.write("IHDR", 12, "ascii");
  result.writeUInt32BE(width, 16);
  result.writeUInt32BE(height, 20);
  return result;
}

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

test("virtual atlas marks only premultiplied texture pages", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ak-atlas-alpha-"));
  const atlasPath = path.join(root, "model.atlas");
  fs.writeFileSync(atlasPath, "first.png\nsize: 1,1\n\nsecond.png\nsize: 1,1\n");
  const output = virtualAtlas({ atlasPath, pages: ["first.png", "second.png"], pageAlphaModes: ["pma", "straight"] });
  assert.match(output, /^texture-0\.png\npma: true\nsize: 1,1/m);
  assert.match(output, /\ntexture-1\.png\nsize: 1,1/m);
});

test("scanner repairs numbered extraction atlas texture references", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ak-numbered-atlas-"));
  const directory = path.join(root, "char_test_2", "DynIllust", "dyn_test");
  fs.mkdirSync(directory, { recursive: true });
  const atlasPath = path.join(directory, "model$0.atlas");
  fs.writeFileSync(atlasPath, "\nmodel.png\nsize: 1,1\nformat: RGBA8888\nfilter: Linear,Linear\nrepeat: none\n");
  fs.writeFileSync(path.join(directory, "model.png"), "base");
  fs.writeFileSync(path.join(directory, "model$0.png"), "background");
  fs.writeFileSync(path.join(directory, "model$0.skel"), Buffer.from([0, 4, 51, 46, 56]));
  const result = scanResources(root);
  assert.deepEqual(result.models[0].pages, ["model$0.png"]);
  assert.deepEqual(result.models[0].pageNames, ["model.png"]);
  assert.match(virtualAtlas(result.models[0]), /^texture-0-[a-f0-9]{10}\.png/m);
  fs.rmSync(root, { recursive: true, force: true });
});

test("scanner pairs separately exported alpha pages and rejects mismatched masks", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ak-alpha-atlas-"));
  const directory = path.join(root, "char_test_2", "DynPortrait", "dyn_test");
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "model.atlas"), "texture.png\nsize: 2,3\nformat: RGBA8888\nfilter: Linear,Linear\nrepeat: none\n");
  fs.writeFileSync(path.join(directory, "texture.png"), pngHeader());
  fs.writeFileSync(path.join(directory, "texture[alpha].png"), pngHeader());
  fs.writeFileSync(path.join(directory, "model.skel"), Buffer.from([0, 4, 51, 46, 56]));
  const paired = scanResources(root);
  assert.equal(paired.issues.length, 0);
  assert.equal(paired.models[0].pageAlphaPaths[0], path.join(directory, "texture[alpha].png"));

  fs.writeFileSync(path.join(directory, "texture[alpha].png"), pngHeader(1, 1));
  const mismatched = scanResources(root);
  assert.equal(mismatched.issues.some((issue) => issue.problem === "alpha-size-mismatch"), true);
  fs.rmSync(root, { recursive: true, force: true });
});
