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

function outfitForGroup(group, character) {
  if (group.skinName) return group.skinName;
  if (!character) return "动态资源";
  if (group.id.toLowerCase() === character.id.toLowerCase()) return "默认服装";
  const suffix = group.id.slice(character.id.length + 1);
  return suffix === "2" ? "精英二" : suffix || "默认服装";
}

function outfitForStatic(model) {
  if (model.kind === "StaticE1") return "精英一";
  if (model.kind === "StaticE2") return "精英二";
  const suffix = model.groupId.slice(model.characterId.length + 1);
  return suffix || "默认服装";
}

function normalizedOutfit(value) {
  return value.trim().toLocaleLowerCase();
}

function modelOrder(model) {
  const outfit = normalizedOutfit(model.outfit || "");
  if (model.kind === "StaticE1" || outfit === "精英一") return 0;
  if (model.kind === "StaticE2" || outfit === "精英二") return 1;
  if (outfit === "默认服装") return 2;
  return 3;
}

export function mergeStaticArt(index, staticArt) {
  const groups = new Map();
  const ensureGroup = (id, character, fallbackName = id) => {
    const key = id.toLowerCase();
    if (!groups.has(key)) groups.set(key, {
      id,
      name: character?.Name || character?.Appellation || fallbackName,
      aliases: [character?.Appellation, character?.Name].filter(Boolean),
      models: [],
      outfitNames: new Map(),
    });
    return groups.get(key);
  };

  for (const sourceGroup of index.groups) {
    const character = characterForGroup(sourceGroup.id, staticArt.characters);
    const targetId = character?.id || sourceGroup.id;
    const customName = sourceGroup.name !== sourceGroup.id ? sourceGroup.name : targetId;
    const group = ensureGroup(targetId, character, customName);
    if (sourceGroup.name !== sourceGroup.id) group.name = sourceGroup.name;
    const outfitId = sourceGroup.id;
    const outfit = outfitForGroup(sourceGroup, character);
    group.outfitNames.set(outfitId.toLowerCase(), outfit);
    group.models.push(...sourceGroup.models.map((model) => ({
      ...model,
      groupId: group.id,
      characterId: character?.id,
      outfitId,
      outfit,
    })));
  }

  for (const sourceModel of staticArt.models) {
    const character = staticArt.characters[sourceModel.characterId]
      ? { id: sourceModel.characterId, ...staticArt.characters[sourceModel.characterId] }
      : null;
    const targetId = character?.id || sourceModel.characterId || sourceModel.groupId;
    const group = ensureGroup(targetId, character);
    const outfitId = sourceModel.kind === "StaticE1"
      ? `${sourceModel.characterId}_1`
      : sourceModel.kind === "StaticE2"
        ? `${sourceModel.characterId}_2`
        : sourceModel.groupId;
    const outfit = group.outfitNames.get(outfitId.toLowerCase()) || outfitForStatic(sourceModel);
    if (!group.outfitNames.has(outfitId.toLowerCase())) group.outfitNames.set(outfitId.toLowerCase(), outfit);
    group.models.push({ ...sourceModel, groupId: group.id, outfitId, outfit });
  }

  const kindOrder = { StaticE1: 0, StaticE2: 0, StaticSkin: 0, DynIllust: 1, DynPortrait: 2, DynIllustStart: 3, BattleFront: 4, BattleBack: 5 };
  const mergedGroups = [...groups.values()].map((group) => {
    const models = group.models.map((model) => ({
      ...model,
      outfit: group.outfitNames.get(model.outfitId.toLowerCase()) || model.outfit,
    })).sort((left, right) => modelOrder(left) - modelOrder(right)
      || (modelOrder(left) === 3 ? left.outfit.localeCompare(right.outfit, "zh-CN", { numeric: true }) : 0)
      || (kindOrder[left.kind] ?? 99) - (kindOrder[right.kind] ?? 99)
      || left.label.localeCompare(right.label, "zh-CN", { numeric: true }));
    const outfits = [...new Map(models.map((model) => [normalizedOutfit(model.outfit), model.outfit])).values()];
    return {
      id: group.id,
      name: group.name,
      skinName: `${outfits.length} 个造型 · ${models.length} 项资源`,
      aliases: group.aliases,
      outfits,
      models,
    };
  }).sort((left, right) => left.name.localeCompare(right.name, "zh-CN") || left.id.localeCompare(right.id));

  return {
    groups: mergedGroups,
    models: mergedGroups.flatMap((group) => group.models),
    issues: index.issues,
  };
}
