import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import { normalizeScene, sceneGeometry, moveSceneLayer, MAX_SCENE_LAYERS } from "../src/scene.js";
import { attachSceneResources, SceneStore, sceneLibrary } from "../server/scenes.mjs";
import { sceneRoutes } from "../server/scene-routes.mjs";

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ark-scene-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
function png(root, relative, width = 200, height = 100) {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const bytes = Buffer.alloc(24);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
  bytes.write("IHDR", 12); bytes.writeUInt32BE(width, 16); bytes.writeUInt32BE(height, 20);
  fs.writeFileSync(file, bytes);
  return file;
}
const layer = (overrides = {}) => normalizeScene({ layers: [{ id: "layer-1", assetId: "asset-1", ...overrides }] }).layers[0];

test("scene settings clamp unsafe values, reject paths and preserve ordered independent layers", () => {
  const result = normalizeScene({ layers: [
    { id: "one", assetId: "background:bg_test:hd", x: -999, y: 999, scale: 999, opacity: -2, blend: "evil", fit: "evil" },
    { id: "one", assetId: "duplicate" }, { id: "two", assetId: "../../private.png" },
    { id: "three", assetId: "safe", scale: NaN, x: "", y: null, enabled: false },
  ] });
  assert.deepEqual(result.layers.map(l => l.id), ["one", "three"]);
  assert.deepEqual(result.layers[0], { id: "one", assetId: "background:bg_test:hd", x: -200, y: 200, scale: 8, opacity: 0, blend: "normal", fit: "contain", enabled: true });
  assert.equal(result.layers[1].scale, 1);
  assert.equal(result.layers[1].enabled, false);
  assert.equal(normalizeScene({ layers: Array.from({ length: 25 }, (_, i) => ({ id: `l-${i}`, assetId: "a" })) }).layers.length, MAX_SCENE_LAYERS);
  assert.deepEqual(normalizeScene(null), { layers: [] });
});

test("scene layout and drag use each viewport's CSS dimensions, including scales beyond character limits", () => {
  const asset = { width: 200, height: 100 };
  assert.deepEqual(sceneGeometry(layer(), asset, 800, 600), { left: 0, top: 100, width: 800, height: 400 });
  assert.deepEqual(sceneGeometry(layer({ fit: "cover" }), asset, 800, 600), { left: -200, top: 0, width: 1200, height: 600 });
  assert.deepEqual(sceneGeometry(layer({ fit: "stretch", scale: .1, x: 25, y: -25 }), asset, 800, 600), { left: 560, top: 120, width: 80, height: 60 });
  const a = sceneGeometry(layer({ fit: "width", scale: 4, x: 20 }), asset, 800, 600);
  const b = sceneGeometry(layer({ fit: "width", scale: 4, x: 20 }), asset, 1600, 1200);
  for (const key of Object.keys(a)) assert.equal(b[key], a[key] * 2);
  const moved = moveSceneLayer(layer({ x: -10, y: 5 }), 80, -120, 800, 600);
  assert.equal(moved.x, 0); assert.equal(moved.y, -15); assert.equal(moved.scale, 1);
});

test("external pictures stay in their source outfit and exclude atlas pages, masks and invalid PNGs", t => {
  const root = fixture(t);
  const files = [png(root, "outfit_a/DynIllust/character.png"), png(root, "outfit_a/bg$2.png"),
    png(root, "outfit_a/bg[alpha]$2.png"), png(root, "outfit_b/bg.png"), png(root, "outfit_a/invalid.png", 0)];
  const mesh = path.join(root, "outfit_a", "bg.obj"); fs.writeFileSync(mesh, "v 0 0 0\n"); files.push(mesh);
  const model = { id: "model-a", relativeAtlas: path.join("outfit_a", "DynIllust", "character.atlas"), atlasPath: path.join(root, "outfit_a", "DynIllust", "character.atlas"), pages: ["character.png"] };
  const other = { ...model, id: "model-b", relativeAtlas: path.join("outfit_b", "model.atlas"), pages: [] };
  attachSceneResources(root, [model, other], files);
  assert.equal(model.sceneAssets.length, 1); assert.equal(other.sceneAssets.length, 1);
  assert.equal(model.sceneAssets[0].name, "bg$2.png"); assert.equal(model.sceneAssets[0].alphaPath, files[2]);
  assert.deepEqual(model.scene, { imageCount: 1, meshCount: 1, placement: "manual" });
  const first = { ...model.sceneAssets[0] };
  fs.utimesSync(files[2], new Date(), new Date(Date.now() + 2000));
  attachSceneResources(root, [model], files);
  assert.equal(model.sceneAssets[0].id, first.id); assert.notEqual(model.sceneAssets[0].version, first.version);
  const published = JSON.stringify(sceneLibrary(model, []));
  assert.ok(!published.includes(root)); assert.ok(!published.includes("alphaPath")); assert.ok(!published.includes("relativeAtlas"));
  png(root, "outfit_a/bg[alpha]$2.png", 1, 1);
  attachSceneResources(root, [model], files);
  assert.equal(model.sceneAssets[0].alphaPath, undefined);
});

test("background library composes the two HD halves and also works for static models", t => {
  const root = fixture(t);
  const background = { id: "bg_test", name: "Test", imagePath: png(root, "blur.png", 400, 200), leftPath: png(root, "left.png", 400, 400), rightPath: png(root, "right.png", 400, 400) };
  const assets = sceneLibrary({ id: "static-model" }, [background]);
  assert.equal(assets[0].id, "background:bg_test:hd"); assert.equal(assets[0].width, 800); assert.equal(assets[0].height, 400);
  assert.equal(assets[0].imageUrls.length, 2); assert.equal(assets[1].width, 400);
});

test("scene persistence survives restart, protects concurrent edits and tolerates missing saved assets", t => {
  const root = fixture(t), file = path.join(root, "scenes.json"), store = new SceneStore(file);
  const initial = store.get("model-a");
  const preset = { layers: [layer()] };
  const saved = store.save("model-a", preset, initial.revision, [{ id: "asset-1" }]);
  assert.deepEqual(new SceneStore(file).get("model-a"), saved);
  assert.deepEqual(store.get("model-b").preset.layers, []);
  assert.deepEqual(store.save("model-a", { layers: [] }, initial.revision, []), { conflict: true });
  assert.throws(() => store.save("model-a", { layers: [layer({ assetId: "unknown" })] }, saved.revision, []), TypeError);
  assert.throws(() => store.save("model-a", { layers: [layer(), layer()] }, saved.revision, []), TypeError);
  assert.equal(store.save("model-a", preset, saved.revision, []).revision, saved.revision);
  store.save("model-a", { layers: [] }, saved.revision, []);
  assert.equal(store.get("model-a").preset.layers.length, 0);
  fs.writeFileSync(file, "broken{");
  assert.throws(() => store.save("model-a", preset, initial.revision, []));
  assert.equal(fs.readFileSync(file, "utf8"), "broken{");
});

test("scene HTTP API validates origin/assets/revisions and emits updates without navigation", async t => {
  const root = fixture(t);
  const file = png(root, "image.png");
  const models = [{ id: "model-a", sceneAssets: [{ id: "asset-1", file, width: 200, height: 100, version: "v1", name: "image.png" }] }, { id: "model-b" }];
  const app = express();
  app.use("/api", sceneRoutes({ findModel: id => models.find(m => m.id === id), backgrounds: () => [], store: new SceneStore(path.join(root, "scenes.json")) }));
  const server = await new Promise(resolve => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const endpoint = `${base}/api/models/model-a/scene`;
  const initial = await (await fetch(endpoint)).json();
  assert.equal(initial.assets.length, 1);
  const events = await fetch(`${base}/api/scene-events`, { signal: AbortSignal.timeout(5000) });
  const reader = events.body.getReader(); t.after(() => reader.cancel());
  assert.match(new TextDecoder().decode((await reader.read()).value), /data: ready/);
  const body = { preset: { layers: [layer()] }, revision: initial.revision };
  const put = (payload = body, headers = {}) => fetch(endpoint, { method: "PUT", headers: { "Content-Type": "application/json", Origin: base, ...headers }, body: JSON.stringify(payload) });
  assert.equal((await put(body, { Origin: "https://external.invalid" })).status, 403);
  assert.equal((await put(body, { Host: "external.invalid", Origin: "http://external.invalid" })).status, 403);
  assert.equal((await put(body, { "Sec-Fetch-Site": "cross-site" })).status, 403);
  assert.equal((await put(body, { "Content-Type": "text/plain" })).status, 415);
  assert.equal((await put({ ...body, extra: "x".repeat(25000) })).status, 413);
  assert.equal((await put({ ...body, preset: { layers: [layer({ assetId: "arbitrary" })] } })).status, 400);
  assert.equal((await put()).status, 200);
  assert.match(new TextDecoder().decode((await reader.read()).value), /data: model-a/);
  assert.equal((await put()).status, 409);
  const restored = await (await fetch(endpoint)).json(); assert.deepEqual(restored.preset, body.preset);
  assert.equal((await fetch(`${base}/api/models/model-b/scene-assets/asset-1.png`)).status, 404);
  const image = await fetch(`${base}/api/models/model-a/scene-assets/asset-1.png`);
  assert.equal(image.status, 200); assert.match(image.headers.get("cache-control"), /immutable/);
  assert.deepEqual(Buffer.from(await image.arrayBuffer()), fs.readFileSync(file));
  assert.equal((await fetch(`${base}/api/models/missing/scene`)).status, 404);
});
