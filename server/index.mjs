import fs from "node:fs";
import path from "node:path";
import express from "express";
import { config } from "./config.mjs";
import { publicCatalog, scanResources, virtualAtlas } from "./catalog.mjs";

const app = express();
app.disable("x-powered-by");
let index = scanResources(config.resourceRoot, config.metadataFile);
const findModel = (id) => index.models.find((model) => model.id === id);

app.get("/api/status", (_request, response) => response.json({ ready: true, ...publicCatalog(index).stats }));
app.get("/api/catalog", (request, response) => {
  if (request.query.refresh === "1") index = scanResources(config.resourceRoot, config.metadataFile);
  response.json(publicCatalog(index));
});
app.get("/api/models/:id/model.atlas", (request, response) => {
  const model = findModel(request.params.id);
  if (!model) return response.status(404).json({ error: "模型不存在" });
  response.type("text/plain").send(virtualAtlas(model));
});
app.get("/api/models/:id/skeleton.:format", (request, response) => {
  const model = findModel(request.params.id);
  if (!model) return response.status(404).json({ error: "模型不存在" });
  response.type(model.skeletonFormat === "binary" ? "application/octet-stream" : "application/json").sendFile(model.skeletonPath);
});
app.get("/api/models/:id/:texture", (request, response) => {
  const model = findModel(request.params.id);
  if (!model) return response.status(404).json({ error: "模型不存在" });
  const match = /^texture-(\d+)\.[a-z0-9]+$/i.exec(request.params.texture);
  const page = match ? model.pages[Number(match[1])] : null;
  if (!page) return response.status(404).json({ error: "纹理不存在" });
  response.set("Cache-Control", "public, max-age=31536000, immutable");
  response.sendFile(path.join(path.dirname(model.atlasPath), page));
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
