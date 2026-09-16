import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { detectPngAlphaMode } from "./png-alpha.mjs";

const TEXTURE_PATTERN = /\.(?:png|webp|jpe?g)$/i;
// Bump whenever server-side texture composition or alpha normalization changes
// so immutable browser and wallpaper caches cannot reuse an older rendering.
const TEXTURE_PIPELINE_VERSION = "alpha-v5";

function pngDimensions(filePath) {
  if (!filePath || path.extname(filePath).toLowerCase() !== ".png") return null;
  try {
    const header = Buffer.alloc(24);
    const descriptor = fs.openSync(filePath, "r");
    try { fs.readSync(descriptor, header, 0, header.length, 0); } finally { fs.closeSync(descriptor); }
    if (!header.subarray(1, 4).equals(Buffer.from("PNG"))) return null;
    return { width: header.readUInt32BE(16), height: header.readUInt32BE(20) };
  } catch { return null; }
}

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(absolute) : [absolute];
  });
}

function atlasPages(atlasPath) {
  const directory = path.dirname(atlasPath);
  const atlasStem = path.basename(atlasPath, ".atlas");
  return fs.readFileSync(atlasPath, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => TEXTURE_PATTERN.test(line))
    .map((atlasName) => {
      const extension = path.extname(atlasName);
      const numberedSibling = /\$\d+$/.test(atlasStem) ? `${atlasStem}${extension}` : null;
      const sourceName = numberedSibling && fs.existsSync(path.join(directory, numberedSibling)) ? numberedSibling : atlasName;
      const alphaNames = [
        sourceName.replace(/\.png$/i, "[alpha].png"),
        sourceName.replace(/\$(\d+)\.png$/i, "[alpha]$$$1.png"),
      ];
      const alphaName = alphaNames.find((candidate) => candidate !== sourceName && fs.existsSync(path.join(directory, candidate)));
      return { atlasName, sourceName, alphaPath: alphaName ? path.join(directory, alphaName) : null };
    })
    .filter(({ sourceName }) => fs.existsSync(path.join(directory, sourceName)));
}

function assetVersion(...filePaths) {
  const fingerprint = filePaths.filter(Boolean).map((filePath) => {
    const stat = fs.statSync(filePath);
    return `${stat.size}:${stat.mtimeMs}`;
  }).concat(TEXTURE_PIPELINE_VERSION).join("|");
  return crypto.createHash("sha1").update(fingerprint).digest("hex").slice(0, 10);
}

function skeletonForAtlas(atlasPath, directoryFiles) {
  const base = atlasPath.slice(0, -".atlas".length);
  const exact = [`${base}.skel`, base].find((candidate) => fs.existsSync(candidate));
  if (exact) return exact;
  const candidates = directoryFiles.filter((candidate) => candidate.endsWith(".skel") || !path.extname(candidate));
  return candidates.length === 1 ? candidates[0] : null;
}

function readSpineVersion(skeletonPath) {
  const buffer = fs.readFileSync(skeletonPath);
  if (buffer[0] === 0x7b) {
    try { return JSON.parse(buffer.toString()).skeleton?.spine || "unknown"; } catch { return "invalid-json"; }
  }
  let offset = 0;
  const readVarint = () => {
    let value = 0;
    let shift = 0;
    let byte;
    do {
      byte = buffer[offset++];
      value |= (byte & 0x7f) << shift;
      shift += 7;
    } while (byte & 0x80);
    return value;
  };
  const readString = () => {
    const length = readVarint();
    if (!length) return null;
    const value = buffer.subarray(offset, offset + length - 1).toString();
    offset += length - 1;
    return value;
  };
  try { readString(); return readString() || "unknown"; } catch { return "parse-error"; }
}

function loadMetadata(metadataFile) {
  if (!metadataFile || !fs.existsSync(metadataFile)) return { groups: {} };
  try { return JSON.parse(fs.readFileSync(metadataFile, "utf8")); } catch { return { groups: {} }; }
}

export function scanResources(resourceRoot, metadataFile) {
  const allFiles = walk(resourceRoot);
  const directoryMap = new Map();
  for (const file of allFiles) {
    const directory = path.dirname(file);
    if (!directoryMap.has(directory)) directoryMap.set(directory, []);
    directoryMap.get(directory).push(file);
  }
  const metadata = loadMetadata(metadataFile);
  const models = [];
  const issues = [];
  const referencedAlphaPaths = new Set();
  for (const atlasPath of allFiles.filter((file) => file.endsWith(".atlas")).sort()) {
    const directory = path.dirname(atlasPath);
    const relativeAtlas = path.relative(resourceRoot, atlasPath);
    const parts = relativeAtlas.split(path.sep);
    const groupId = parts[0];
    const kind = parts[1] || "Unknown";
    const skeletonPath = skeletonForAtlas(atlasPath, directoryMap.get(directory) || []);
    const pageMappings = atlasPages(atlasPath);
    if (!skeletonPath || !pageMappings.length) {
      issues.push({ atlas: relativeAtlas, problem: !skeletonPath ? "missing-skeleton" : "missing-texture" });
      continue;
    }
    for (const mapping of pageMappings.filter(({ alphaPath }) => alphaPath)) {
      referencedAlphaPaths.add(mapping.alphaPath);
      const colorSize = pngDimensions(path.join(directory, mapping.sourceName));
      const alphaSize = pngDimensions(mapping.alphaPath);
      if (!colorSize || !alphaSize || colorSize.width !== alphaSize.width || colorSize.height !== alphaSize.height) {
        issues.push({ atlas: relativeAtlas, texture: mapping.sourceName, problem: "alpha-size-mismatch" });
      }
    }
    const id = crypto.createHash("sha1").update(relativeAtlas).digest("hex").slice(0, 16);
    models.push({
      id,
      groupId,
      kind,
      label: `${kind} · ${path.basename(atlasPath, ".atlas")}`,
      relativeAtlas,
      atlasPath,
      skeletonPath,
      skeletonFormat: skeletonPath.endsWith(".skel") ? "binary" : "json",
      spineVersion: readSpineVersion(skeletonPath),
      assetVersion: assetVersion(atlasPath, skeletonPath, ...pageMappings.flatMap(({ sourceName, alphaPath }) => [path.join(directory, sourceName), alphaPath])),
      pages: pageMappings.map(({ sourceName }) => sourceName),
      pageNames: pageMappings.map(({ atlasName }) => atlasName),
      pageAlphaPaths: pageMappings.map(({ alphaPath }) => alphaPath),
      pageAssetVersions: pageMappings.map(({ sourceName, alphaPath }) => assetVersion(path.join(directory, sourceName), alphaPath)),
    });
  }
  for (const alphaPath of allFiles.filter((file) => /\[alpha\](?:\$\d+)?\.png$/i.test(file))) {
    if (!referencedAlphaPaths.has(alphaPath)) issues.push({ texture: path.relative(resourceRoot, alphaPath), problem: "orphan-alpha" });
  }
  const byGroup = new Map();
  for (const model of models) {
    if (!byGroup.has(model.groupId)) byGroup.set(model.groupId, []);
    byGroup.get(model.groupId).push(model);
  }
  const kindOrder = { DynIllust: 0, DynPortrait: 1, DynIllustStart: 2, BattleFront: 3, BattleBack: 4 };
  const groups = [...byGroup.entries()].map(([id, entries]) => {
    entries.sort((a, b) => (kindOrder[a.kind] ?? 9) - (kindOrder[b.kind] ?? 9) || a.label.localeCompare(b.label));
    const extra = metadata.groups?.[id] || {};
    return { id, name: extra.name || id, skinName: extra.skinName || "", models: entries };
  }).sort((a, b) => a.name.localeCompare(b.name));
  return { groups, models, issues };
}

export function publicCatalog(index) {
  return {
    stats: { groups: index.groups.length, models: index.models.length, issues: index.issues.length },
    issues: index.issues,
    groups: index.groups.map((group) => ({
      id: group.id,
      name: group.name,
      skinName: group.skinName,
      aliases: group.aliases || [],
      outfits: group.outfits || [],
      models: group.models.map((model) => ({
        id: model.id,
        kind: model.kind,
        label: model.label,
        outfit: model.outfit,
        outfitId: model.outfitId,
        mediaType: model.mediaType || "spine",
        format: model.skeletonFormat,
        spineVersion: model.spineVersion,
        textureCount: model.pages?.length || 0,
        skeletonUrl: model.skeletonFormat ? `/api/models/${model.id}/skeleton.${model.skeletonFormat === "binary" ? "skel" : "json"}?v=${model.assetVersion}` : null,
        atlasUrl: model.atlasPath ? `/api/models/${model.id}/model.atlas?v=${model.assetVersion}` : null,
        ...(model.mediaType === "image" ? {
          format: model.format,
          width: model.width,
          height: model.height,
          imageUrl: `/api/models/${model.id}/image.png?v=${model.assetVersion}`,
          alphaUrl: model.alphaPath ? `/api/models/${model.id}/alpha.png?v=${model.assetVersion}` : null,
          spineVersion: null,
          textureCount: 1,
          skeletonUrl: null,
          atlasUrl: null,
        } : {}),
      })),
    })),
  };
}

export function virtualAtlas(model) {
  const aliases = new Map((model.pageNames || model.pages).map((page, index) => [page, {
    name: `texture-${index}${model.pageAssetVersions?.[index] ? `-${model.pageAssetVersions[index]}` : ""}${path.extname(model.pages[index]).toLowerCase()}`,
    alphaMode: model.pageAlphaPaths?.[index] ? "straight" : model.pageAlphaModes?.[index]
      || (path.extname(model.pages[index]).toLowerCase() === ".png" && fs.existsSync(path.join(path.dirname(model.atlasPath), model.pages[index]))
        ? detectPngAlphaMode(path.join(path.dirname(model.atlasPath), model.pages[index]))
        : "straight"),
  }]));
  const source = fs.readFileSync(model.atlasPath, "utf8");
  const newline = source.includes("\r\n") ? "\r\n" : "\n";
  return source.split(/\r?\n/).flatMap((line) => {
    const alias = aliases.get(line.trim());
    return alias ? [alias.name, ...(alias.alphaMode === "pma" ? ["pma: true"] : [])] : [line];
  }).join(newline);
}

export function pageAlphaMode(model, index) {
  if (model.pageAlphaPaths?.[index]) return "straight";
  const pagePath = path.join(path.dirname(model.atlasPath), model.pages[index]);
  return path.extname(pagePath).toLowerCase() === ".png" ? detectPngAlphaMode(pagePath) : "straight";
}
