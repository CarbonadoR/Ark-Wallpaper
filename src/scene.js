import { calculateLayout, FIT_MODES } from "./layout.js";

export const MAX_SCENE_LAYERS = 16;
const number = (value, fallback, min, max) => value == null || value === "" || !Number.isFinite(Number(value)) ? fallback : Math.max(min, Math.min(max, Number(value)));
const identifier = (value) => typeof value === "string" && /^[a-z0-9_:-]{1,128}$/i.test(value);

export function normalizeScene(value = {}) {
  const ids = new Set();
  return {
    layers: (Array.isArray(value?.layers) ? value.layers : []).slice(0, MAX_SCENE_LAYERS).flatMap((layer) => {
      if (!layer || !identifier(layer.id) || !identifier(layer.assetId) || ids.has(layer.id)) return [];
      ids.add(layer.id);
      return [{ id: layer.id, assetId: layer.assetId, enabled: layer.enabled !== false,
        fit: FIT_MODES.includes(layer.fit) ? layer.fit : "contain",
        x: number(layer.x, 0, -200, 200), y: number(layer.y, 0, -200, 200), scale: number(layer.scale, 1, .05, 8),
        opacity: number(layer.opacity, 1, 0, 1), blend: ["normal", "screen", "multiply"].includes(layer.blend) ? layer.blend : "normal" }];
    }),
  };
}

export function sceneGeometry(layer, asset, width, height) {
  // Position is relative to this viewport, independent of the character transform.
  const layout = calculateLayout({ screenWidth: width, screenHeight: height,
    contentWidth: asset.width, contentHeight: asset.height, fit: layer.fit, scale: 1 });
  const w = asset.width * layout.scaleX * layer.scale;
  const h = asset.height * layout.scaleY * layer.scale;
  return { left: width * (.5 + layer.x / 100) - w / 2, top: height * (.5 + layer.y / 100) - h / 2, width: w, height: h };
}

export function moveSceneLayer(layer, dx, dy, width, height) {
  return normalizeScene({ layers: [{ ...layer, x: layer.x + dx / Math.max(1, width) * 100, y: layer.y + dy / Math.max(1, height) * 100 }] }).layers[0];
}
