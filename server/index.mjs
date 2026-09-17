import fs from "node:fs";
import path from "node:path";
import express from "express";
import { config } from "./config.mjs";
import { clockAssets } from "./clock-assets.mjs";
import { publicBackgrounds, scanBackgrounds } from "./backgrounds.mjs";
import { pageAlphaMode, publicCatalog, scanResources, virtualAtlas } from "./catalog.mjs";
import { renderTexturePng } from "./png-alpha.mjs";
import { mergeStaticArt, scanStaticArt } from "./static-art.mjs";

const app = express();
app.disable("x-powered-by");
const buildIndex = () => mergeStaticArt(
  scanResources(config.resourceRoot, config.metadataFile),
  scanStaticArt(config),
);
let index = buildIndex();
let backgrounds = scanBackgrounds(config.backgroundRoot);
const clockAssetPaths = clockAssets(config.uiRoot);
const findModel = (id) => index.models.find((model) => model.id === id);

app.get("/api/status", (_request, response) => response.json({ ready: true, ...publicCatalog(index).stats, backgrounds: backgrounds.length }));
app.get("/api/catalog", (request, response) => {
  if (request.query.refresh === "1") {
    index = buildIndex();
    backgrounds = scanBackgrounds(config.backgroundRoot);
  }
  response.json(publicCatalog(index));
});
app.get("/api/backgrounds", (_request, response) => response.json({ backgrounds: publicBackgrounds(backgrounds) }));
app.get("/api/backgrounds/:id/image", (request, response) => {
  const background = backgrounds.find((entry) => entry.id === request.params.id);
  if (!background) return response.status(404).json({ error: "背景不存在" });
  response.set("Cache-Control", "public, max-age=31536000, immutable");
  response.type("image/png").sendFile(background.imagePath);
});
app.get("/api/backgrounds/:id/:side", (request, response) => {
  const background = backgrounds.find((entry) => entry.id === request.params.id);
  if (!background || !["left", "right"].includes(request.params.side)) return response.status(404).json({ error: "背景不存在" });
  response.set("Cache-Control", "public, max-age=31536000, immutable");
  response.type("image/png").sendFile(request.params.side === "left" ? background.leftPath : background.rightPath);
});
app.get("/api/clock/assets/:id", (request, response) => {
  const filePath = clockAssetPaths[request.params.id];
  if (!filePath) return response.status(404).json({ error: "时钟主题素材不存在" });
  response.set("Cache-Control", "public, max-age=31536000, immutable");
  response.type("image/png").sendFile(filePath);
});
app.get("/api/models/:id/model.atlas", (request, response) => {
  const model = findModel(request.params.id);
  if (!model?.atlasPath) return response.status(404).json({ error: "动态模型不存在" });
  response.type("text/plain").send(virtualAtlas(model));
});
app.get("/api/models/:id/image.png", (request, response) => {
  const model = findModel(request.params.id);
  if (!model?.imagePath) return response.status(404).json({ error: "静态立绘不存在" });
  response.set("Cache-Control", "public, max-age=31536000, immutable");
  response.type("image/png").sendFile(model.imagePath);
});
app.get("/api/models/:id/alpha.png", (request, response) => {
  const model = findModel(request.params.id);
  if (!model?.alphaPath) return response.status(404).json({ error: "Alpha 遮罩不存在" });
  response.set("Cache-Control", "public, max-age=31536000, immutable");
  response.type("image/png").sendFile(model.alphaPath);
});
app.get("/api/models/:id/skeleton.:format", (request, response) => {
  const model = findModel(request.params.id);
  if (!model?.skeletonPath) return response.status(404).json({ error: "动态模型不存在" });
  response.type(model.skeletonFormat === "binary" ? "application/octet-stream" : "application/json").sendFile(model.skeletonPath);
});
app.get("/api/models/:id/:texture", (request, response) => {
  const model = findModel(request.params.id);
  if (!model?.atlasPath) return response.status(404).json({ error: "动态模型不存在" });
  const match = /^texture-(\d+)(?:-[a-f0-9]+)?\.[a-z0-9]+$/i.exec(request.params.texture);
  const pageIndex = match ? Number(match[1]) : -1;
  const page = model.pages[pageIndex];
  if (!page) return response.status(404).json({ error: "纹理不存在" });
  response.set("Cache-Control", "public, max-age=31536000, immutable");
  const colorPath = path.join(path.dirname(model.atlasPath), page);
  const alphaPath = model.pageAlphaPaths?.[pageIndex];
  const rendered = path.extname(colorPath).toLowerCase() === ".png"
    ? renderTexturePng(colorPath, {
      alphaPath,
      alphaMode: pageAlphaMode(model, pageIndex),
      atlasPath: model.atlasPath,
      pageName: model.pageNames?.[pageIndex] || page,
    })
    : null;
  if (rendered) return response.type("image/png").send(rendered);
  response.sendFile(colorPath);
});

if (fs.existsSync(config.distDir)) {
  app.use(express.static(config.distDir));
  app.get("*splat", (_request, response) => response.sendFile(path.join(config.distDir, "index.html")));
}
app.use((error, _request, response, _next) => {
  console.error(error);
  response.status(500).json({ error: error.message || "服务器错误" });
});
app.listen(config.port, config.host, () => {
  console.log(`Arknights viewer: http://${config.host}:${config.port} · ${index.groups.length} groups / ${index.models.length} models`);
});
