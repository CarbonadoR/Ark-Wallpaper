import fs from "node:fs";
import path from "node:path";

const SAFE_BACKGROUND_ID = /^[a-z0-9_-]+$/i;

export function scanBackgrounds(backgroundRoot) {
  if (!backgroundRoot || !fs.existsSync(backgroundRoot)) return [];
  return fs.readdirSync(backgroundRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && SAFE_BACKGROUND_ID.test(entry.name))
    .map((entry) => {
      const directory = path.join(backgroundRoot, entry.name);
      const imagePath = path.join(directory, `${entry.name}.png`);
      const leftPath = path.join(directory, `${entry.name}_left.png`);
      const rightPath = path.join(directory, `${entry.name}_right.png`);
      return fs.existsSync(imagePath) && fs.existsSync(leftPath) && fs.existsSync(rightPath) ? {
        id: entry.name,
        name: entry.name.replace(/^bg_/, "").replaceAll("_", " "),
        imagePath,
        leftPath,
        rightPath,
      } : null;
    })
    .filter(Boolean)
    .sort((left, right) => left.id.localeCompare(right.id));
}

export function publicBackgrounds(backgrounds) {
  return backgrounds.flatMap(({ id, name }) => [
    {
      id: `${id}:hd`,
      name: `${name} · 高清`,
      imageUrls: [`/api/backgrounds/${encodeURIComponent(id)}/left`, `/api/backgrounds/${encodeURIComponent(id)}/right`],
    },
    {
      id: `${id}:blur`,
      name: `${name} · 模糊`,
      imageUrls: [`/api/backgrounds/${encodeURIComponent(id)}/image`],
    },
  ]);
}
