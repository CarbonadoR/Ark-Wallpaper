import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { detectPngAlphaMode } from "../server/png-alpha.mjs";

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
