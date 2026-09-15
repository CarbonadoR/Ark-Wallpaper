import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { detectPngAlphaMode } from "./png-alpha.mjs";

const TEXTURE_PATTERN = /\.(?:png|webp|jpe?g)$/i;

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
      return { atlasName, sourceName };
    })
    .filter(({ sourceName }) => fs.existsSync(path.join(directory, sourceName)));
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
      pages: pageMappings.map(({ sourceName }) => sourceName),
      pageNames: pageMappings.map(({ atlasName }) => atlasName),
    });
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
      models: group.models.map((model) => ({
        id: model.id,
        kind: model.kind,
        label: model.label,
        format: model.skeletonFormat,
        spineVersion: model.spineVersion,
        textureCount: model.pages.length,
        skeletonUrl: `/api/models/${model.id}/skeleton.${model.skeletonFormat === "binary" ? "skel" : "json"}`,
        atlasUrl: `/api/models/${model.id}/model.atlas`,
      })),
    })),
  };
}

export function virtualAtlas(model) {
  const aliases = new Map((model.pageNames || model.pages).map((page, index) => [page, {
    name: `texture-${index}${path.extname(model.pages[index]).toLowerCase()}`,
    alphaMode: model.pageAlphaModes?.[index]
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
