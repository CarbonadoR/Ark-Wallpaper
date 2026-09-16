import fs from "node:fs";
import zlib from "node:zlib";

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const alphaModeCache = new Map();
// Dark straight-alpha pixels can satisfy RGB <= alpha just like premultiplied
// pixels, so their encoding cannot always be inferred from pixel values alone.
// These resource families use a consistent export pipeline and need an
// explicit mode before falling back to the pixel heuristic below.
const ALPHA_MODE_OVERRIDES = [
  { pattern: /ambiencesynesthesia/i, mode: "straight" },
];

function paeth(left, up, upperLeft) {
  const prediction = left + up - upperLeft;
  const leftDistance = Math.abs(prediction - left);
  const upDistance = Math.abs(prediction - up);
  const upperLeftDistance = Math.abs(prediction - upperLeft);
  return leftDistance <= upDistance && leftDistance <= upperLeftDistance ? left : upDistance <= upperLeftDistance ? up : upperLeft;
}

export function detectPngAlphaMode(filePath) {
  const override = ALPHA_MODE_OVERRIDES.find(({ pattern }) => pattern.test(filePath));
  if (override) return override.mode;
  const stat = fs.statSync(filePath);
  const cacheKey = `${stat.size}:${stat.mtimeMs}`;
  const cached = alphaModeCache.get(filePath);
  if (cached?.key === cacheKey) return cached.mode;
  const png = fs.readFileSync(filePath);
  if (png.length < 33 || !png.subarray(0, 8).equals(PNG_SIGNATURE)) return "straight";

  let offset = 8;
  let width = 0;
  let height = 0;
  let supported = false;
  const imageData = [];
  while (offset + 12 <= png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString("ascii", offset + 4, offset + 8);
    const data = png.subarray(offset + 8, offset + 8 + length);
    offset += length + 12;
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      supported = data[8] === 8 && data[9] === 6 && data[12] === 0;
    } else if (type === "IDAT") {
      imageData.push(data);
    } else if (type === "IEND") {
      break;
    }
  }
  if (!supported || !width || !height || !imageData.length) return "straight";

  let packed;
  try { packed = zlib.inflateSync(Buffer.concat(imageData)); } catch { return "straight"; }
  const stride = width * 4;
  if (packed.length < height * (stride + 1)) return "straight";

  let sourceOffset = 0;
  let previous = Buffer.alloc(stride);
  let current = Buffer.alloc(stride);
  let partialPixels = 0;
  let straightAlphaPixels = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = packed[sourceOffset++];
    if (filter > 4) return "straight";
    for (let x = 0; x < stride; x += 1) {
      const value = packed[sourceOffset++];
      const left = x >= 4 ? current[x - 4] : 0;
      const up = previous[x];
      const upperLeft = x >= 4 ? previous[x - 4] : 0;
      const predictor = filter === 1 ? left : filter === 2 ? up : filter === 3 ? Math.floor((left + up) / 2) : filter === 4 ? paeth(left, up, upperLeft) : 0;
      current[x] = (value + predictor) & 0xff;
    }
    for (let x = 0; x < stride; x += 4) {
      const alpha = current[x + 3];
      if (alpha === 0 || alpha === 255) continue;
      partialPixels += 1;
      if (Math.max(current[x], current[x + 1], current[x + 2]) > alpha + 2) straightAlphaPixels += 1;
    }
    [previous, current] = [current, previous];
  }

  const mode = partialPixels && straightAlphaPixels / partialPixels < 0.01 ? "pma" : "straight";
  alphaModeCache.set(filePath, { key: cacheKey, mode });
  return mode;
}
