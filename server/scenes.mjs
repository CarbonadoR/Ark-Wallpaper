import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { normalizeScene, MAX_SCENE_LAYERS } from "../src/scene.js";
import { publicBackgrounds } from "./backgrounds.mjs";

const hash = (value) => crypto.createHash("sha256").update(value).digest("hex").slice(0, 16);
export function sceneImageSize(file) {
  try {
    const data = Buffer.alloc(24);
    const fd = fs.openSync(file, "r");
    try { fs.readSync(fd, data, 0, 24, 0); } finally { fs.closeSync(fd); }
    if (!data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || data.toString("ascii", 12, 16) !== "IHDR") return null;
    const width = data.readUInt32BE(16), height = data.readUInt32BE(20);
    return width > 0 && height > 0 && width <= 32768 && height <= 32768 ? { width, height } : null;
  } catch { return null; }
}

// Only index unreferenced pictures from the same source outfit, never another
// operator/outfit merged into the public character group. No inferred placement.
export function attachSceneResources(root, models, files) {
  const referenced = new Set(models.flatMap(m => m.pages.map(p => path.resolve(path.dirname(m.atlasPath), p))));
  const realRoot = fs.realpathSync(root);
  const withinRoot = file => {
    try {
      const relative = path.relative(realRoot, fs.realpathSync(file));
      return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
    } catch { return false; }
  };
  const groups = new Map();
  for (const file of files) {
    const source = path.relative(root, file).split(path.sep)[0];
    if (!groups.has(source)) groups.set(source, { assets: [], meshCount: 0 });
    const group = groups.get(source);
    if (path.extname(file).toLowerCase() === ".obj") group.meshCount++;
    if (!/\.png$/i.test(file) || /\[alpha\]/i.test(file) || referenced.has(path.resolve(file))) continue;
    if (!withinRoot(file)) continue;
    const size = sceneImageSize(file);
    if (!size) continue;
    const alphaPath = [file.replace(/\.png$/i, "[alpha].png"), file.replace(/\$(\d+)\.png$/i, "[alpha]$$$1.png")]
      .find(candidate => candidate !== file && withinRoot(candidate)
        && JSON.stringify(sceneImageSize(candidate)) === JSON.stringify(size));
    const relative = path.relative(root, file).split(path.sep).join("/");
    const version = hash([file, alphaPath].filter(Boolean).map(p => { const s = fs.statSync(p); return `${s.size}:${s.mtimeMs}`; }).join("|") + "scene-v1");
    group.assets.push({ id: hash(relative), name: path.basename(file), ...size, file, alphaPath, version });
  }
  for (const model of models) {
    const group = groups.get(model.relativeAtlas.split(path.sep)[0]);
    model.sceneAssets = group?.assets || [];
    model.scene = { imageCount: model.sceneAssets.length, meshCount: group?.meshCount || 0, placement: "manual" };
  }
}

export function sceneLibrary(model, backgrounds) {
  const local = (model.sceneAssets || []).map(({ id, name, width, height, version }) => ({
    id, name, width, height, source: "outfit", imageUrls: [`/api/models/${model.id}/scene-assets/${id}.png?v=${version}`],
  }));
  return [...local, ...publicBackgrounds(backgrounds).flatMap(b => {
    const source = backgrounds.find(item => b.id.startsWith(item.id + ":"));
    const hd = b.id.endsWith(":hd");
    const left = sceneImageSize(hd ? source.leftPath : source.imagePath);
    const right = hd ? sceneImageSize(source.rightPath) : null;
    if (!left || (hd && !right)) return [];
    return [{ ...b, id: `background:${b.id}`, source: "background", width: left.width + (right?.width || 0), height: Math.max(left.height, right?.height || 0) }];
  })];
}

export class SceneStore {
  constructor(file) { this.file = file; }
  readAll() {
    if (!fs.existsSync(this.file)) return {};
    const data = JSON.parse(fs.readFileSync(this.file, "utf8"));
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Invalid scene settings");
    return data;
  }
  get(modelId) {
    const preset = normalizeScene(this.readAll()[modelId]);
    return { preset, revision: hash(JSON.stringify(preset)) };
  }
  save(modelId, value, revision, assets) {
    const all = this.readAll();
    if (hash(JSON.stringify(normalizeScene(all[modelId]))) !== revision) return { conflict: true };
    const preset = normalizeScene(value);
    if (!Array.isArray(value?.layers) || value.layers.length > MAX_SCENE_LAYERS || value.layers.length !== preset.layers.length)
      throw new TypeError("Invalid scene layers");
    // Missing assets may remain in an existing recipe after a resource is moved;
    // they render as missing, not as arbitrary server paths.
    const allowed = new Set([...assets.map(a => a.id), ...normalizeScene(all[modelId]).layers.map(l => l.assetId)]);
    if (preset.layers.some(l => !allowed.has(l.assetId))) throw new TypeError("Unknown scene asset");
    all[modelId] = preset;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const temporary = `${this.file}.tmp`;
    const fd = fs.openSync(temporary, "w");
    try { fs.writeFileSync(fd, JSON.stringify(all, null, 2)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(temporary, this.file);
    return { preset, revision: hash(JSON.stringify(preset)) };
  }
}
