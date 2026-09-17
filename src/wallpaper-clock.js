export const CLOCK_THEME_IDS = ["rhodes", "lonetrail", "rainbowsix", "volcano", "monochrome"];

const bounded = (value, fallback, minimum, maximum) => {
  if (value == null || value === "") return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback;
};

const boolean = (value, fallback) => {
  if (value == null) return fallback;
  if (typeof value === "string") return !["0", "false", "off", "no"].includes(value.toLowerCase());
  return Boolean(value);
};

const perspective = (value) => {
  const normalized = String(value ?? "").toLowerCase();
  if (["left", "right"].includes(normalized)) return normalized;
  if (["", "none", "0", "false", "off", "no"].includes(normalized)) return "none";
  return boolean(value, false) ? "left" : "none";
};

export function normalizeWallpaperClock(settings = {}) {
  const theme = String(settings.theme || "rhodes").toLowerCase();
  return {
    enabled: boolean(settings.enabled, true),
    theme: CLOCK_THEME_IDS.includes(theme) ? theme : "rhodes",
    scale: bounded(settings.scale, 1, 0.5, 2),
    x: bounded(settings.x, 82, 4, 96),
    y: bounded(settings.y, 18, 6, 94),
    locked: boolean(settings.locked, true),
    perspective: perspective(settings.perspective),
    pointerPerspective: boolean(settings.pointerPerspective, false),
  };
}

export function wallpaperClockFromSearch(searchParams) {
  return normalizeWallpaperClock({
    enabled: searchParams.get("clock"),
    theme: searchParams.get("clockTheme"),
    scale: searchParams.get("clockScale"),
    x: searchParams.get("clockX"),
    y: searchParams.get("clockY"),
    locked: searchParams.get("clockLocked"),
    perspective: searchParams.get("clockPerspective"),
    pointerPerspective: searchParams.get("clockPointerPerspective"),
  });
}

export function clockPointerTilt({ pointerX, pointerY, clockX, clockY, viewportWidth, viewportHeight }) {
  const width = Math.max(1, Number(viewportWidth) || 1);
  const height = Math.max(1, Number(viewportHeight) || 1);
  const centerX = width * bounded(clockX, 50, 0, 100) / 100;
  const centerY = height * bounded(clockY, 50, 0, 100) / 100;
  const depth = Math.max(width, height) * 1.7;
  const degrees = 180 / Math.PI;
  return {
    rotateX: Math.min(9, Math.max(-9, Math.atan2(centerY - Number(pointerY || 0), depth) * degrees)),
    rotateY: Math.min(13, Math.max(-13, Math.atan2(Number(pointerX || 0) - centerX, depth) * degrees)),
  };
}

export function moveWallpaperClock(settings, { deltaX, deltaY, viewportWidth, viewportHeight }) {
  return normalizeWallpaperClock({
    ...settings,
    x: settings.x + Number(deltaX || 0) / Math.max(1, Number(viewportWidth) || 1) * 100,
    y: settings.y + Number(deltaY || 0) / Math.max(1, Number(viewportHeight) || 1) * 100,
  });
}
