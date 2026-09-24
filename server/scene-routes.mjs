import express from "express";
import { renderTexturePng } from "./png-alpha.mjs";
import { sceneLibrary } from "./scenes.mjs";

export function sceneRoutes({ findModel, backgrounds, store }) {
  const router = express.Router();
  const clients = new Set();
  router.get("/scene-events", (request, response) => {
    response.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "X-Accel-Buffering": "no" });
    response.flushHeaders();
    response.write("data: ready\n\n");
    clients.add(response);
    const keepAlive = setInterval(() => response.write(": keep-alive\n\n"), 30000);
    request.on("close", () => { clearInterval(keepAlive); clients.delete(response); });
  });
  router.get("/models/:id/scene", (request, response) => {
    const model = findModel(request.params.id);
    if (!model) return response.status(404).json({ error: "模型不存在" });
    try { response.set("Cache-Control", "no-store").json({ ...store.get(model.id), assets: sceneLibrary(model, backgrounds()), scene: model.scene }); }
    catch { response.status(500).json({ error: "场景配置读取失败，请检查本机场景配置文件。" }); }
  });
  router.put("/models/:id/scene", (request, response, next) => {
    // The new write API accepts only same-origin JSON; existing read APIs remain unchanged.
    const host = new URL(`${request.protocol}://${request.get("host")}`).hostname;
    if (!["127.0.0.1", "localhost", "[::1]"].includes(host)
        || (request.headers.origin && request.headers.origin !== `${request.protocol}://${request.get("host")}`)
        || request.headers["sec-fetch-site"] === "cross-site") return response.sendStatus(403);
    if (!request.is("application/json")) return response.sendStatus(415);
    next();
  }, express.json({ limit: "24kb" }), (request, response) => {
    const model = findModel(request.params.id);
    if (!model) return response.status(404).json({ error: "模型不存在" });
    try {
      const saved = store.save(model.id, request.body.preset, request.body.revision, sceneLibrary(model, backgrounds()));
      if (saved.conflict) return response.status(409).json({ error: "场景已在其他窗口更新，请重新载入后编辑。" });
      for (const client of clients) client.write(`data: ${model.id}\n\n`);
      response.json(saved);
    } catch (error) { response.status(error instanceof TypeError ? 400 : 500).json({ error: error instanceof TypeError ? "场景图层无效，请检查所选素材。" : "场景保存失败，请检查本地配置文件及写入权限。" }); }
  });
  router.get("/models/:id/scene-assets/:asset.png", (request, response) => {
    const asset = findModel(request.params.id)?.sceneAssets?.find(item => item.id === request.params.asset);
    if (!asset) return response.status(404).json({ error: "场景图片不存在" });
    response.set("Cache-Control", "public, max-age=31536000, immutable");
    if (asset.alphaPath) return response.type("image/png").send(renderTexturePng(asset.file, { alphaPath: asset.alphaPath }));
    response.sendFile(asset.file);
  });
  router.use((error, _request, response, _next) => response.status(error.status === 413 ? 413 : 400).json({ error: "场景请求无法读取。" }));
  return router;
}
