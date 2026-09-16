import fs from "node:fs";
import zlib from "node:zlib";

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const alphaModeCache = new Map();
const renderedTextureCache = new Map();
const MAX_RENDERED_TEXTURES = 12;
const ATLAS_TEXTURE_PATTERN = /\.(?:png|webp|jpe?g)$/i;
// The current art export preserves straight-looking RGB in some translucent
// pixels even on PMA atlases. Fully straight atlases consistently exceed this
// ratio, while known PMA atlases remain below it.
const STRAIGHT_ALPHA_RATIO = 0.9;
// A single atlas can contain both PMA artwork and straight-alpha effects. An
// attachment whose translucent pixels meaningfully violate the PMA invariant
// is normalized as one unit. This also catches dark straight-alpha
// pixels that cannot be identified from RGB <= alpha alone.
const STRAIGHT_REGION_RATIO = 0.1;
const MIN_REGION_PARTIAL_PIXELS = 16;
const HAZE_REGION_RATIO = 0.8;
const MIN_HAZE_PARTIAL_PIXELS = 128;
const HAZE_REGION_PATTERN = /(?:smoke|smock|fog|mist|light|glow|halo|aura|(?:^|[_/])(?:eff|fx)(?:[_/]|$)|(?:^|[_/])ring(?:[_/]|$))/i;
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

function decodeRgbaPng(input) {
  const png = Buffer.isBuffer(input) ? input : fs.readFileSync(input);
  if (png.length < 33 || !png.subarray(0, 8).equals(PNG_SIGNATURE)) return null;

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
  if (!supported || !width || !height || !imageData.length) return null;

  let packed;
  try { packed = zlib.inflateSync(Buffer.concat(imageData)); } catch { return null; }
  const stride = width * 4;
  if (packed.length < height * (stride + 1)) return null;

  let sourceOffset = 0;
  let previous = Buffer.alloc(stride);
  let current = Buffer.alloc(stride);
  const pixels = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const filter = packed[sourceOffset++];
    if (filter > 4) return null;
    for (let x = 0; x < stride; x += 1) {
      const value = packed[sourceOffset++];
      const left = x >= 4 ? current[x - 4] : 0;
      const up = previous[x];
      const upperLeft = x >= 4 ? previous[x - 4] : 0;
      const predictor = filter === 1 ? left : filter === 2 ? up : filter === 3 ? Math.floor((left + up) / 2) : filter === 4 ? paeth(left, up, upperLeft) : 0;
      current[x] = (value + predictor) & 0xff;
    }
    current.copy(pixels, y * stride);
    [previous, current] = [current, previous];
  }

  return { width, height, pixels };
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const name = Buffer.from(type, "ascii");
  const output = Buffer.alloc(data.length + 12);
  output.writeUInt32BE(data.length, 0);
  name.copy(output, 4);
  data.copy(output, 8);
  output.writeUInt32BE(crc32(Buffer.concat([name, data])), data.length + 8);
  return output;
}

function encodeRgbaPng({ width, height, pixels }) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 6, 0, 0, 0], 8);
  const stride = width * 4;
  const scanlines = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y += 1) pixels.copy(scanlines, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk("IHDR", header),
    pngChunk("IDAT", zlib.deflateSync(scanlines)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function fileFingerprint(filePath) {
  const stat = fs.statSync(filePath);
  return `${filePath}:${stat.size}:${stat.mtimeMs}`;
}

function rememberTexture(key, value) {
  renderedTextureCache.delete(key);
  renderedTextureCache.set(key, value);
  while (renderedTextureCache.size > MAX_RENDERED_TEXTURES) renderedTextureCache.delete(renderedTextureCache.keys().next().value);
  return value;
}

function atlasRegions(atlasPath, pageName) {
  if (!atlasPath || !pageName) return [];
  const regions = [];
  let currentPage = null;
  let currentRegion = null;
  for (const line of fs.readFileSync(atlasPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (!/^\s/.test(line)) {
      if (ATLAS_TEXTURE_PATTERN.test(trimmed)) {
        currentPage = trimmed;
        currentRegion = null;
      } else if (currentPage === pageName) {
        currentRegion = { name: trimmed, rotate: false };
        regions.push(currentRegion);
      } else {
        currentRegion = null;
      }
      continue;
    }
    if (!currentRegion) continue;
    let match = trimmed.match(/^bounds:\s*(\d+),\s*(\d+),\s*(\d+),\s*(\d+)/i);
    if (match) {
      currentRegion.bounds = match.slice(1).map(Number);
      continue;
    }
    match = trimmed.match(/^xy:\s*(\d+),\s*(\d+)/i);
    if (match) {
      currentRegion.xy = match.slice(1).map(Number);
      continue;
    }
    match = trimmed.match(/^size:\s*(\d+),\s*(\d+)/i);
    if (match) {
      currentRegion.size = match.slice(1).map(Number);
      continue;
    }
    match = trimmed.match(/^rotate:\s*(.+)$/i);
    if (match) currentRegion.rotate = /^(?:true|90|270)$/i.test(match[1].trim());
  }
  return regions.flatMap((region) => {
    if (region.bounds) {
      const [x, y, width, height] = region.bounds;
      return [{ name: region.name, x, y, width, height }];
    }
    if (!region.xy || !region.size) return [];
    const [x, y] = region.xy;
    const [sourceWidth, sourceHeight] = region.size;
    return [{ name: region.name, x, y, width: region.rotate ? sourceHeight : sourceWidth, height: region.rotate ? sourceWidth : sourceHeight }];
  });
}

function regionMasks(image, regions) {
  if (!regions.length) return { straight: null, haze: null, hasHaze: false };
  const straight = new Uint8Array(image.width * image.height);
  const haze = new Uint8Array(image.width * image.height);
  let hasHaze = false;
  for (const region of regions) {
    const right = Math.min(image.width, region.x + region.width);
    const bottom = Math.min(image.height, region.y + region.height);
    let partialPixels = 0;
    let straightAlphaPixels = 0;
    for (let y = Math.max(0, region.y); y < bottom; y += 1) {
      for (let x = Math.max(0, region.x); x < right; x += 1) {
        const index = (y * image.width + x) * 4;
        const alpha = image.pixels[index + 3];
        if (alpha === 0 || alpha === 255) continue;
        partialPixels += 1;
        if (Math.max(image.pixels[index], image.pixels[index + 1], image.pixels[index + 2]) > alpha + 2) straightAlphaPixels += 1;
      }
    }
    const straightRatio = partialPixels ? straightAlphaPixels / partialPixels : 0;
    const normalizeStraight = partialPixels >= MIN_REGION_PARTIAL_PIXELS && straightRatio >= STRAIGHT_REGION_RATIO;
    const attenuateHaze = partialPixels >= MIN_HAZE_PARTIAL_PIXELS && straightRatio >= HAZE_REGION_RATIO && HAZE_REGION_PATTERN.test(region.name);
    if (!normalizeStraight && !attenuateHaze) continue;
    hasHaze ||= attenuateHaze;
    for (let y = Math.max(0, region.y); y < bottom; y += 1) {
      const start = y * image.width + Math.max(0, region.x);
      const end = y * image.width + right;
      if (normalizeStraight) straight.fill(1, start, end);
      if (attenuateHaze) haze.fill(1, start, end);
    }
  }
  return { straight, haze, hasHaze };
}

export function inspectPngAlpha(filePath) {
  const decoded = decodeRgbaPng(filePath);
  if (!decoded) return null;
  let partialPixels = 0;
  let straightAlphaPixels = 0;
  for (let index = 0; index < decoded.pixels.length; index += 4) {
    const alpha = decoded.pixels[index + 3];
    if (alpha === 0 || alpha === 255) continue;
    partialPixels += 1;
    if (Math.max(decoded.pixels[index], decoded.pixels[index + 1], decoded.pixels[index + 2]) > alpha + 2) straightAlphaPixels += 1;
  }

  return {
    partialPixels,
    straightAlphaPixels,
    straightRatio: partialPixels ? straightAlphaPixels / partialPixels : 1,
  };
}

export function renderTexturePng(colorPath, { alphaPath = null, alphaMode = "straight", atlasPath = null, pageName = null } = {}) {
  const key = [fileFingerprint(colorPath), alphaPath ? fileFingerprint(alphaPath) : "", atlasPath ? fileFingerprint(atlasPath) : "", pageName || "", alphaMode].join("|");
  if (renderedTextureCache.has(key)) return renderedTextureCache.get(key);
  const color = decodeRgbaPng(colorPath);
  if (!color) return null;
  const masks = regionMasks(color, atlasRegions(atlasPath, pageName));
  if (!alphaPath && alphaMode !== "pma" && !masks.hasHaze) return null;

  if (alphaPath) {
    const mask = decodeRgbaPng(alphaPath);
    if (!mask || mask.width !== color.width || mask.height !== color.height) throw new Error("动态纹理与 Alpha 遮罩尺寸不一致");
    for (let index = 0; index < color.pixels.length; index += 4) color.pixels[index + 3] = mask.pixels[index];
  } else {
    for (let index = 0; index < color.pixels.length; index += 4) {
      const sourceAlpha = color.pixels[index + 3];
      const alpha = masks.haze?.[index / 4] ? Math.round(sourceAlpha * sourceAlpha * sourceAlpha / (255 * 255)) : sourceAlpha;
      const maximum = Math.max(color.pixels[index], color.pixels[index + 1], color.pixels[index + 2]);
      color.pixels[index + 3] = alpha;
      if (sourceAlpha === 0) {
        color.pixels[index] = 0;
        color.pixels[index + 1] = 0;
        color.pixels[index + 2] = 0;
      } else if (alphaMode === "pma" && (masks.straight?.[index / 4] || maximum > sourceAlpha + 2)) {
        color.pixels[index] = Math.round(color.pixels[index] * alpha / 255);
        color.pixels[index + 1] = Math.round(color.pixels[index + 1] * alpha / 255);
        color.pixels[index + 2] = Math.round(color.pixels[index + 2] * alpha / 255);
      } else if (alphaMode === "pma" && alpha !== sourceAlpha) {
        color.pixels[index] = Math.round(color.pixels[index] * alpha / sourceAlpha);
        color.pixels[index + 1] = Math.round(color.pixels[index + 1] * alpha / sourceAlpha);
        color.pixels[index + 2] = Math.round(color.pixels[index + 2] * alpha / sourceAlpha);
      }
    }
  }
  return rememberTexture(key, encodeRgbaPng(color));
}

export function detectPngAlphaMode(filePath) {
  const override = ALPHA_MODE_OVERRIDES.find(({ pattern }) => pattern.test(filePath));
  if (override) return override.mode;
  const stat = fs.statSync(filePath);
  const cacheKey = `${stat.size}:${stat.mtimeMs}`;
  const cached = alphaModeCache.get(filePath);
  if (cached?.key === cacheKey) return cached.mode;
  const stats = inspectPngAlpha(filePath);
  const mode = stats?.partialPixels && stats.straightRatio < STRAIGHT_ALPHA_RATIO ? "pma" : "straight";
  alphaModeCache.set(filePath, { key: cacheKey, mode });
  return mode;
}
