export const FIT_MODES = ["contain", "cover", "width", "height", "stretch"];
const finite = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const bool = (value, fallback) => value === true || value === "1" || value === "true" ? true : value === false || value === "0" || value === "false" ? false : fallback;

export function normalizeLayout(value = {}) {
  return {
    fit: FIT_MODES.includes(value.fit) ? value.fit : "contain",
    scale: clamp(finite(value.scale, 1), 0.25, 3),
    offsetX: clamp(finite(value.offsetX, 0), -100, 100),
    offsetY: clamp(finite(value.offsetY, 0), -100, 100),
    locked: bool(value.locked, true),
  };
}

export function layoutFromSearch(params) {
  return normalizeLayout({ fit: params.get("fit"), scale: params.get("scale"), offsetX: params.get("x"), offsetY: params.get("y"), locked: params.get("locked") });
}

export function calculateLayout({ screenWidth, screenHeight, contentWidth, contentHeight, ...value }) {
  const settings = normalizeLayout(value);
  const wr = Math.max(1, screenWidth) / Math.max(1, contentWidth);
  const hr = Math.max(1, screenHeight) / Math.max(1, contentHeight);
  let sx;
  let sy;
  if (settings.fit === "contain") sx = sy = Math.min(wr, hr);
  else if (settings.fit === "width") sx = sy = wr;
  else if (settings.fit === "height") sx = sy = hr;
  else if (settings.fit === "stretch") { sx = wr; sy = hr; }
  else sx = sy = Math.max(wr, hr);
  return { scaleX: sx * settings.scale, scaleY: sy * settings.scale, x: screenWidth / 2 + screenWidth * settings.offsetX / 100, y: screenHeight / 2 + screenHeight * settings.offsetY / 100 };
}
