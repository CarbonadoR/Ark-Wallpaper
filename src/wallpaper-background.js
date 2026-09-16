export const DEFAULT_WALLPAPER_BACKGROUND = Object.freeze({
  color: "#000000",
  imageUrl: "",
  imageUrls: [],
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
  const imageUrls = (Array.isArray(settings.imageUrls) ? settings.imageUrls : [settings.imageUrl])
    .map(imageUrl)
    .filter(Boolean)
    .slice(0, 2);
  return {
    color: color(settings.color),
    imageUrl: imageUrls.length === 1 ? imageUrls[0] : "",
    imageUrls,
    spineId: String(settings.spineId || "").trim().slice(0, 128),
  };
}

export function wallpaperBackgroundFromSearch(searchParams) {
  const left = searchParams.get("backgroundImageLeft") || searchParams.get("bgImageLeft");
  const right = searchParams.get("backgroundImageRight") || searchParams.get("bgImageRight");
  return normalizeWallpaperBackground({
    color: searchParams.get("background") || searchParams.get("bg"),
    imageUrl: searchParams.get("backgroundImage") || searchParams.get("bgImage"),
    imageUrls: left && right ? [left, right] : undefined,
    spineId: searchParams.get("backgroundSpine") || searchParams.get("bgSpine"),
  });
}
