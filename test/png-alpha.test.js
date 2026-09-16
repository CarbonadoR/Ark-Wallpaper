import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { detectPngAlphaMode, inspectPngAlpha, renderTexturePng } from "../server/png-alpha.mjs";

function chunk(type, data) {
  const output = Buffer.alloc(data.length + 12);
  output.writeUInt32BE(data.length, 0);
  output.write(type, 4, 4, "ascii");
  data.copy(output, 8);
  return output;
}

function rgbaPng(pixel) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1, 0);
  header.writeUInt32BE(1, 4);
  header.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", zlib.deflateSync(Buffer.from([0, ...pixel]))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function rgbaRowPng(pixels) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(pixels.length, 0);
  header.writeUInt32BE(1, 4);
  header.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", zlib.deflateSync(Buffer.from([0, ...pixels.flat()]))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function decodedRow(buffer) {
  let offset = 8;
  const chunks = [];
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    if (type === "IDAT") chunks.push(buffer.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
  }
  return [...zlib.inflateSync(Buffer.concat(chunks)).subarray(1)];
}

test("detects premultiplied and straight-alpha PNG pixels", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ak-alpha-"));
  const premultiplied = path.join(root, "premultiplied.png");
  const straight = path.join(root, "straight.png");
  fs.writeFileSync(premultiplied, rgbaPng([64, 32, 0, 128]));
  fs.writeFileSync(straight, rgbaPng([255, 128, 0, 128]));
  assert.equal(detectPngAlphaMode(premultiplied), "pma");
  assert.equal(detectPngAlphaMode(straight), "straight");
  fs.rmSync(root, { recursive: true, force: true });
});

test("uses straight alpha for Ambience Synesthesia resources with ambiguous dark pixels", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ak-alpha-"));
  const directory = path.join(root, "char_test_AmbienceSynesthesia#1");
  const texture = path.join(directory, "texture.png");
  fs.mkdirSync(directory);
  fs.writeFileSync(texture, rgbaPng([32, 16, 0, 128]));
  assert.equal(detectPngAlphaMode(texture), "straight");
  fs.rmSync(root, { recursive: true, force: true });
});

test("tolerates straight-looking outliers in current premultiplied exports", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ak-alpha-"));
  const texture = path.join(root, "mixed-export.png");
  fs.writeFileSync(texture, rgbaRowPng([
    [64, 32, 0, 128],
    [255, 128, 0, 128],
  ]));
  assert.equal(detectPngAlphaMode(texture), "pma");
  fs.rmSync(root, { recursive: true, force: true });
});

test("normalizes invalid transparent RGB in mixed premultiplied exports", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ak-alpha-"));
  const texture = path.join(root, "mixed.png");
  const normalized = path.join(root, "normalized.png");
  fs.writeFileSync(texture, rgbaRowPng([
    [64, 32, 0, 128],
    [255, 128, 0, 128],
    [255, 255, 255, 0],
  ]));
  fs.writeFileSync(normalized, renderTexturePng(texture, { alphaMode: "pma" }));
  assert.deepEqual(inspectPngAlpha(normalized), { partialPixels: 2, straightAlphaPixels: 0, straightRatio: 0 });
  fs.rmSync(root, { recursive: true, force: true });
});

test("normalizes ambiguous dark pixels inside straight-alpha atlas regions", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ak-alpha-region-"));
  const texture = path.join(root, "texture.png");
  const atlas = path.join(root, "model.atlas");
  const sourcePixels = Array.from({ length: 20 }, (_value, index) => index < 2
    ? [255, 180, 120, 128]
    : [32, 16, 8, 128]);
  fs.writeFileSync(texture, rgbaRowPng(sourcePixels));
  fs.writeFileSync(atlas, [
    "texture.png",
    "size: 20,1",
    "format: RGBA8888",
    "filter: Linear,Linear",
    "repeat: none",
    "effect",
    "  rotate: false",
    "  xy: 0, 0",
    "  size: 20, 1",
    "  orig: 20, 1",
    "  offset: 0, 0",
    "  index: -1",
  ].join("\n"));
  const normalized = renderTexturePng(texture, { alphaMode: "pma", atlasPath: atlas, pageName: "texture.png" });
  const pixels = decodedRow(normalized);
  assert.deepEqual(pixels.slice(-4), [16, 8, 4, 128]);
  fs.rmSync(root, { recursive: true, force: true });
});

test("attenuates broad low-alpha haze attachments without changing their RGB", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ak-alpha-haze-"));
  const texture = path.join(root, "texture.png");
  const atlas = path.join(root, "model.atlas");
  fs.writeFileSync(texture, rgbaRowPng(Array.from({ length: 128 }, () => [255, 240, 224, 128])));
  fs.writeFileSync(atlas, [
    "texture.png",
    "size: 128,1",
    "format: RGBA8888",
    "filter: Linear,Linear",
    "repeat: none",
    "background_glow",
    "  rotate: false",
    "  xy: 0, 0",
    "  size: 128, 1",
    "  orig: 128, 1",
    "  offset: 0, 0",
    "  index: -1",
  ].join("\n"));
  const normalized = renderTexturePng(texture, { alphaMode: "straight", atlasPath: atlas, pageName: "texture.png" });
  assert.deepEqual(decodedRow(normalized).slice(-4), [255, 240, 224, 32]);
  fs.rmSync(root, { recursive: true, force: true });
});

test("composes a separately exported alpha mask", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ak-alpha-"));
  const texture = path.join(root, "texture.png");
  const mask = path.join(root, "texture[alpha].png");
  const composed = path.join(root, "composed.png");
  fs.writeFileSync(texture, rgbaPng([200, 100, 50, 255]));
  fs.writeFileSync(mask, rgbaPng([64, 64, 64, 255]));
  fs.writeFileSync(composed, renderTexturePng(texture, { alphaPath: mask }));
  assert.deepEqual(inspectPngAlpha(composed), { partialPixels: 1, straightAlphaPixels: 1, straightRatio: 1 });
  fs.rmSync(root, { recursive: true, force: true });
});
