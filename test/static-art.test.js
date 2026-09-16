import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { mergeStaticArt, scanStaticArt } from "../server/static-art.mjs";

function pngHeader(width = 2, height = 3) {
  const result = Buffer.alloc(24);
  result.set([137, 80, 78, 71, 13, 10, 26, 10]);
  result.write("IHDR", 12, "ascii");
  result.writeUInt32BE(width, 16);
  result.writeUInt32BE(height, 20);
  return result;
}

test("scans elite and skin art while ignoring portrait thumbnails", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ak-static-"));
  const charpackRoot = path.join(root, "charpack");
  const skinpackRoot = path.join(root, "skinpack");
  const characterTableFile = path.join(root, "chartable");
  const characterTableJson = path.join(characterTableFile, "character_table_hash.json");
  const characterDirectory = path.join(charpackRoot, "char_test");
  const skinDirectory = path.join(skinpackRoot, "char_test");
  fs.mkdirSync(characterDirectory, { recursive: true });
  fs.mkdirSync(skinDirectory, { recursive: true });
  fs.mkdirSync(characterTableFile, { recursive: true });
  fs.writeFileSync(characterTableJson, JSON.stringify({ Characters: { char_test: { Name: "测试干员", Appellation: "Tester" } } }));
  fs.writeFileSync(path.join(characterDirectory, "char_test_1.png"), pngHeader());
  fs.writeFileSync(path.join(characterDirectory, "char_test_1[alpha].png"), pngHeader(1, 1));
  fs.writeFileSync(path.join(characterDirectory, "char_test_2$0.png"), pngHeader(4, 5));
  fs.writeFileSync(path.join(skinDirectory, "char_test_summer#1.png"), pngHeader(6, 7));
  fs.writeFileSync(path.join(skinDirectory, "char_test_summer#1b.png"), pngHeader());

  const result = scanStaticArt({ charpackRoot, skinpackRoot, characterTableFile });
  assert.deepEqual(result.models.map((model) => model.kind), ["StaticE1", "StaticE2", "StaticSkin"]);
  assert.equal(result.models[0].alphaPath.endsWith("char_test_1[alpha].png"), true);
  assert.deepEqual({ width: result.models[1].width, height: result.models[1].height }, { width: 4, height: 5 });
  assert.equal(result.models[2].groupId, "char_test_summer#1");
  fs.rmSync(root, { recursive: true, force: true });
});

test("merges every outfit and resource for an operator into one ordered group", () => {
  const dynamic = {
    groups: [
      { id: "char_test_2", name: "char_test_2", skinName: "", models: [{ id: "elite-dyn", kind: "DynIllust", label: "elite dynamic" }] },
      { id: "char_test_summer#1", name: "char_test_summer#1", skinName: "盛夏", models: [
        { id: "skin-dyn", kind: "DynIllust", label: "skin dynamic" },
        { id: "portrait-dyn", kind: "DynPortrait", label: "portrait dynamic" },
      ] },
    ],
    models: [],
    issues: [],
  };
  const staticArt = {
    characters: { char_test: { Name: "测试干员", Appellation: "Tester" } },
    models: [
      { id: "elite-one", groupId: "char_test", characterId: "char_test", kind: "StaticE1", label: "精英一立绘", mediaType: "image" },
      { id: "elite-two", groupId: "char_test", characterId: "char_test", kind: "StaticE2", label: "精英二立绘", mediaType: "image" },
      { id: "skin-static", groupId: "char_test_summer#1", characterId: "char_test", kind: "StaticSkin", label: "皮肤立绘", mediaType: "image" },
    ],
  };
  const result = mergeStaticArt(dynamic, staticArt);
  assert.equal(result.groups.length, 1);
  assert.equal(result.groups[0].id, "char_test");
  assert.equal(result.groups[0].name, "测试干员");
  assert.deepEqual(result.groups[0].aliases, ["Tester", "测试干员"]);
  assert.deepEqual(result.groups[0].outfits, ["精英一", "精英二", "盛夏"]);
  assert.equal(result.groups[0].skinName, "3 个造型 · 6 项资源");
  assert.deepEqual(result.groups[0].models.map((model) => model.id), ["elite-one", "elite-two", "elite-dyn", "skin-static", "skin-dyn", "portrait-dyn"]);
  assert.deepEqual(result.groups[0].models.map((model) => model.outfit), ["精英一", "精英二", "精英二", "盛夏", "盛夏", "盛夏"]);
  assert.equal(result.models.every((model) => model.groupId === "char_test"), true);
});

test("maps alternate Amiya class resources to the canonical operator", () => {
  const dynamic = {
    groups: [
      { id: "char_1001_amiya2_sale#16", name: "char_1001_amiya2_sale#16", skinName: "", models: [{ id: "guard", kind: "DynIllust", label: "guard" }] },
      { id: "char_1037_amiya3_sale#13", name: "char_1037_amiya3_sale#13", skinName: "", models: [{ id: "medic", kind: "DynIllust", label: "medic" }] },
    ],
    models: [],
    issues: [],
  };
  const staticArt = {
    characters: { char_002_amiya: { Name: "阿米娅", Appellation: "Amiya" } },
    models: [{ id: "base", groupId: "char_002_amiya", characterId: "char_002_amiya", kind: "StaticE2", label: "精英二立绘", mediaType: "image" }],
  };
  const result = mergeStaticArt(dynamic, staticArt);
  assert.equal(result.groups.length, 1);
  assert.equal(result.groups[0].id, "char_002_amiya");
  assert.equal(result.groups[0].name, "阿米娅");
  assert.deepEqual(result.groups[0].models.map((model) => model.id), ["base", "medic", "guard"]);
  assert.deepEqual(result.groups[0].models.map((model) => model.outfit), ["精英二", "sale#13", "sale#16"]);
});
