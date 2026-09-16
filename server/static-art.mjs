import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

function readJson(filePath, fallback) {
  if (!filePath || !fs.existsSync(filePath)) return fallback;
  try { return JSON.parse(fs.readFileSync(filePath, "utf8")); } catch { return fallback; }
}

function pngSize(filePath) {
  try {
    const header = Buffer.alloc(24);
    const descriptor = fs.openSync(filePath, "r");
    try { fs.readSync(descriptor, header, 0, header.length, 0); } finally { fs.closeSync(descriptor); }
    if (!header.subarray(1, 4).equals(Buffer.from("PNG"))) return {};
    return { width: header.readUInt32BE(16), height: header.readUInt32BE(20) };
  } catch { return {}; }
}

function stableId(source, relativePath) {
  return crypto.createHash("sha1").update(`static:${source}:${relativePath}`).digest("hex").slice(0, 16);
}

function assetVersion(...filePaths) {
  const fingerprint = filePaths.filter(Boolean).map((filePath) => {
    const stat = fs.statSync(filePath);
    return `${stat.size}:${stat.mtimeMs}`;
  }).join("|");
  return crypto.createHash("sha1").update(fingerprint).digest("hex").slice(0, 10);
}

function imageModel({ source, root, groupId, characterId, kind, label, imagePath, alphaPath = null }) {
  const relativeImage = path.relative(root, imagePath);
  return {
    id: stableId(source, relativeImage),
    groupId,
    characterId,
    kind,
    label,
    mediaType: "image",
    format: "png",
    imagePath,
    alphaPath,
    assetVersion: assetVersion(imagePath, alphaPath),
    ...pngSize(imagePath),
  };
}

function pngFiles(directory) {
  if (!directory || !fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".png"))
    .map((entry) => entry.name);
}

function chooseImage(directory, stem, names) {
  const imageName = `${stem}.png`;
  const numberedImage = names.find((name) => new RegExp(`^${escapeRegExp(stem)}\\$\\d+\\.png$`, "i").test(name));
  const alphaName = names.find((name) => new RegExp(`^${escapeRegExp(stem)}\\[alpha\\](?:\\$\\d+)?\\.png$`, "i").test(name));
  const selected = names.includes(imageName) ? imageName : numberedImage;
  if (!selected) return null;
  return {
    imagePath: path.join(directory, selected),
    alphaPath: alphaName ? path.join(directory, alphaName) : null,
  };
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function scanCharacterArt(root, characters) {
  if (!root || !fs.existsSync(root)) return [];
  const models = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !characters[entry.name]) continue;
    const directory = path.join(root, entry.name);
    const names = pngFiles(directory);
    for (const [rank, kind, label] of [[1, "StaticE1", "精英一立绘"], [2, "StaticE2", "精英二立绘"]]) {
      const selected = chooseImage(directory, `${entry.name}_${rank}`, names);
      if (selected) models.push(imageModel({ source: "character", root, groupId: entry.name, characterId: entry.name, kind, label, ...selected }));
    }
  }
  return models;
}

function canonicalSkinStems(names) {
  return [...new Set(names.map((name) => name
    .replace(/\.png$/i, "")
    .replace(/\$\d+$/, "")
    .replace(/\[alpha\]$/i, ""))
    .filter((name) => name.startsWith("char_") && !name.endsWith("b")))];
}

function scanSkinArt(root, characters) {
  if (!root || !fs.existsSync(root)) return [];
  const models = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !characters[entry.name]) continue;
    const directory = path.join(root, entry.name);
    const names = pngFiles(directory);
    for (const stem of canonicalSkinStems(names)) {
      const selected = chooseImage(directory, stem, names);
      if (!selected) continue;
      const suffix = stem === entry.name ? "默认服装" : stem.slice(entry.name.length + 1);
      models.push(imageModel({ source: "skin", root, groupId: stem, characterId: entry.name, kind: "StaticSkin", label: `皮肤立绘 · ${suffix}`, ...selected }));
    }
  }
  return models;
}

export function loadCharacters(characterTableFile) {
  let selected = characterTableFile;
  if (selected && fs.existsSync(selected) && fs.statSync(selected).isDirectory()) {
    selected = fs.readdirSync(selected, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /^character_table.*\.json$/i.test(entry.name))
      .map((entry) => path.join(selected, entry.name))
      .sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs)[0];
  }
  return readJson(selected, {}).Characters || {};
}

export function scanStaticArt({ charpackRoot, skinpackRoot, characterTableFile }) {
  const characters = loadCharacters(characterTableFile);
  return {
    characters,
    models: [...scanCharacterArt(charpackRoot, characters), ...scanSkinArt(skinpackRoot, characters)],
  };
}

function characterForGroup(groupId, characters) {
  const candidates = Object.keys(characters).filter((id) => groupId === id || groupId.startsWith(`${id}_`));
  const id = candidates.sort((left, right) => right.length - left.length)[0];
  return id ? { id, ...characters[id] } : null;
}

export function mergeStaticArt(index, staticArt) {
  const groups = new Map(index.groups.map((group) => [group.id.toLowerCase(), { ...group, models: [...group.models] }]));
  const defaultDynamicGroups = new Map(index.groups
    .filter((group) => /_2$/i.test(group.id))
    .map((group) => [group.id.slice(0, -2).toLowerCase(), group.id]));

  for (const model of staticArt.models) {
    const requestedGroup = model.kind === "StaticE1" || model.kind === "StaticE2"
      ? defaultDynamicGroups.get(model.groupId.toLowerCase()) || model.groupId
      : model.groupId;
    const key = requestedGroup.toLowerCase();
    const existing = groups.get(key);
    if (existing) {
      model.groupId = existing.id;
      existing.models.push(model);
    } else {
      model.groupId = requestedGroup;
      groups.set(key, { id: requestedGroup, name: requestedGroup, skinName: "", models: [model] });
    }
  }

  const kindOrder = { StaticE1: 0, StaticE2: 1, StaticSkin: 2, DynIllust: 3, DynPortrait: 4, DynIllustStart: 5, BattleFront: 6, BattleBack: 7 };
  const mergedGroups = [...groups.values()].map((group) => {
    const character = characterForGroup(group.id, staticArt.characters);
    const defaultName = character?.Name || character?.Appellation || group.name;
    const suffix = group.id.slice((character?.id?.length || -1) + 1);
    const defaultSkin = group.id === character?.id ? "常规立绘" : suffix === "2" ? "精英二 / 默认服装" : group.skinName || suffix;
    return {
      ...group,
      name: group.name === group.id ? defaultName : group.name,
      skinName: group.skinName || defaultSkin,
      aliases: [character?.Appellation, character?.Name].filter(Boolean),
      models: group.models.sort((left, right) => (kindOrder[left.kind] ?? 99) - (kindOrder[right.kind] ?? 99) || left.label.localeCompare(right.label)),
    };
  }).sort((left, right) => left.name.localeCompare(right.name, "zh-CN") || left.skinName.localeCompare(right.skinName, "zh-CN"));

  return {
    groups: mergedGroups,
    models: mergedGroups.flatMap((group) => group.models),
    issues: index.issues,
  };
}
