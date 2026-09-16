export const DEFAULT_WALLPAPER_BACKGROUND = Object.freeze({
  color: "#000000",
  imageUrl: "",
  spineId: "",
});

function color(value) {
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(value || "").trim());
  if (!match) return DEFAULT_WALLPAPER_BACKGROUND.color;
  const hex = match[1].length === 3 ? [...match[1]].map((digit) => digit.repeat(2)).join("") : match[1];
  return `#${hex.toUpperCase()}`;
}

function imageUrl(value) {
  const url = String(value || "").trim();
  return /^(?:https?:\/\/|\/|data:image\/|blob:)/i.test(url) ? url : "";
}

export function normalizeWallpaperBackground(settings = {}) {
  return {
    color: color(settings.color),
    imageUrl: imageUrl(settings.imageUrl),
    spineId: String(settings.spineId || "").trim().slice(0, 128),
  };
}

export function wallpaperBackgroundFromSearch(searchParams) {
  return normalizeWallpaperBackground({
    color: searchParams.get("background") || searchParams.get("bg"),
    imageUrl: searchParams.get("backgroundImage") || searchParams.get("bgImage"),
    spineId: searchParams.get("backgroundSpine") || searchParams.get("bgSpine"),
  });
}
