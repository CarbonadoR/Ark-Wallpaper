import fs from "node:fs";
import path from "node:path";
import express from "express";
import { config, rootDir } from "./config.mjs";
import { clockAssets } from "./clock-assets.mjs";
import { publicBackgrounds, scanBackgrounds } from "./backgrounds.mjs";
import { pageAlphaMode, publicCatalog, scanResources, virtualAtlas } from "./catalog.mjs";
import { renderTexturePng } from "./png-alpha.mjs";
import { mergeStaticArt, scanStaticArt } from "./static-art.mjs";
import { SceneStore } from "./scenes.mjs";
import { sceneRoutes } from "./scene-routes.mjs";
import { resourceRoutes } from "./resource-routes.mjs";

const app = express();
app.disable("x-powered-by");
const resources = resourceRoutes({ root: rootDir, localConfig: config });
app.use('/api', resources.router);
const buildIndex = () => mergeStaticArt(
  scanResources(config.resourceRoot, config.metadataFile),
  scanStaticArt(config),
);
let index = buildIndex();
let backgrounds = scanBackgrounds(config.backgroundRoot);
const clockAssetPaths = clockAssets(config.uiRoot);
const findModel = (id) => resources.library?.model(id) || index.models.find((model) => model.id === id || model.legacyIds?.includes(id));
const findBackground = (id) => resources.library?.background(id) || backgrounds.find((entry) => entry.id === id);
app.use('/api/models/:id', async (request, _response, next) => {
  try { await resources.ready; await resources.library?.ensureModel(request.params.id); next(); }
  catch (error) { next(findModel(request.params.id) ? undefined : error); }
});
app.use('/api/backgrounds/:id', async (request, _response, next) => {
  try { await resources.ready; await resources.library?.ensureBackground(request.params.id); next(); }
  catch (error) { next(findBackground(request.params.id) ? undefined : error); }
});
app.use("/api", sceneRoutes({ findModel, backgrounds: () => backgrounds,
  store: new SceneStore(process.env.ARKNIGHTS_SCENE_SETTINGS || path.join(rootDir, "config", "scenes.local.json")) }));

app.get("/api/status", (_request, response) => response.json({ ready: true, ...publicCatalog(index).stats, backgrounds: backgrounds.length }));
app.get("/api/catalog", async (request, response) => {
  await resources.ready;
  if (request.query.refresh === "1") {
    index = buildIndex();
    backgrounds = scanBackgrounds(config.backgroundRoot);
    await resources.library?.refresh();
  }
  response.json(resources.library?.catalog(publicCatalog(index)) || publicCatalog(index));
});
app.get("/api/backgrounds", async (_request, response) => { await resources.ready; response.json({ backgrounds: resources.library?.backgrounds(publicBackgrounds(backgrounds)) || publicBackgrounds(backgrounds) }); });
app.get("/api/backgrounds/:id/image", (request, response) => {
  const background = findBackground(request.params.id);
  if (!background) return response.status(404).json({ error: "背景不存在" });
  response.set("Cache-Control", "no-cache");
  response.type("image/png").sendFile(background.imagePath, {dotfiles:'allow'});
});
app.get("/api/backgrounds/:id/:side", (request, response) => {
  const background = findBackground(request.params.id);
  if (!background || !["left", "right"].includes(request.params.side)) return response.status(404).json({ error: "背景不存在" });
  response.set("Cache-Control", "no-cache");
  response.type("image/png").sendFile(request.params.side === "left" ? background.leftPath : background.rightPath, {dotfiles:'allow'});
});
app.get("/api/clock/assets/:id", async (request, response) => {
  try { await resources.ready; await resources.library?.ensureClock(); } catch (error) { if (!clockAssetPaths[request.params.id] && !resources.library?.clock(request.params.id)) throw error; }
  const filePath = resources.library?.clock(request.params.id) || clockAssetPaths[request.params.id];
  if (!filePath) return response.status(404).json({ error: "时钟主题素材不存在" });
  response.set("Cache-Control", "no-cache");
  response.type("image/png").sendFile(filePath, {dotfiles:'allow'});
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
  response.type("image/png").sendFile(model.imagePath, {dotfiles:'allow'});
});
app.get("/api/models/:id/alpha.png", (request, response) => {
  const model = findModel(request.params.id);
  if (!model?.alphaPath) return response.status(404).json({ error: "Alpha 遮罩不存在" });
  response.set("Cache-Control", "public, max-age=31536000, immutable");
  response.type("image/png").sendFile(model.alphaPath, {dotfiles:'allow'});
});
app.get("/api/models/:id/skeleton.:format", (request, response) => {
  const model = findModel(request.params.id);
  if (!model?.skeletonPath) return response.status(404).json({ error: "动态模型不存在" });
  response.type(model.skeletonFormat === "binary" ? "application/octet-stream" : "application/json").sendFile(model.skeletonPath, {dotfiles:'allow'});
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
  response.sendFile(colorPath, {dotfiles:'allow'});
});

if (fs.existsSync(config.distDir)) {
  app.use(express.static(config.distDir));
  app.get("*splat", (_request, response) => response.sendFile(path.join(config.distDir, "index.html"), {dotfiles:'allow'}));
}
app.use((error, _request, response, _next) => {
  console.error(error);
  response.status(500).json({ error: error.message || "服务器错误" });
});
app.listen(config.port, config.host, () => {
  console.log(`Arknights viewer: http://${config.host}:${config.port} · ${index.groups.length} groups / ${index.models.length} models`);
});
