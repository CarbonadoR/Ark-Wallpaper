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
    x: bounded(settings.x, 82, 4, 96),
    y: bounded(settings.y, 18, 6, 94),
    locked: boolean(settings.locked, true),
    perspective: perspective(settings.perspective),
  };
}

export function wallpaperClockFromSearch(searchParams) {
  return normalizeWallpaperClock({
    enabled: searchParams.get("clock"),
    theme: searchParams.get("clockTheme"),
    x: searchParams.get("clockX"),
    y: searchParams.get("clockY"),
    locked: searchParams.get("clockLocked"),
    perspective: searchParams.get("clockPerspective"),
  });
}

export function moveWallpaperClock(settings, { deltaX, deltaY, viewportWidth, viewportHeight }) {
  return normalizeWallpaperClock({
    ...settings,
    x: settings.x + Number(deltaX || 0) / Math.max(1, Number(viewportWidth) || 1) * 100,
    y: settings.y + Number(deltaY || 0) / Math.max(1, Number(viewportHeight) || 1) * 100,
  });
}
