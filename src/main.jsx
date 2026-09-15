import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import * as PIXI from "pixi.js";
import { Spine, settings as spineSettings } from "pixi-spine";
import { calculateLayout, layoutFromSearch, normalizeLayout } from "./layout.js";
import "./styles.css";

spineSettings.yDown = false;
const params = new URLSearchParams(location.search);
const wallpaperMode = params.get("wallpaper") === "1";
const requestedModel = params.get("model") || "";
const initialLayout = layoutFromSearch(params);
const KIND_LABELS = { DynIllust: "动态立绘", DynPortrait: "动态头像", DynIllustStart: "入场动画", BattleFront: "战斗前景", BattleBack: "战斗背景" };

function preferredModel(group) {
  return group?.models.find((model) => model.kind === "DynIllust") || group?.models[0] || null;
}

function loadSpine(model) {
  return new Promise((resolve, reject) => {
    const loader = new PIXI.Loader();
    const key = `spine-${model.id}-${Date.now()}`;
    loader.onError.once((error) => reject(error));
    loader.add(key, model.skeletonUrl, {
      metadata: {
        spineAtlasFile: model.atlasUrl,
        imageMetadata: { alphaMode: PIXI.ALPHA_MODES.PMA },
      },
    });
    loader.load((_instance, resources) => {
      const resource = resources[key];
      if (!resource?.spineData) return reject(new Error("Spine 数据解析失败"));
      resolve({ spine: new Spine(resource.spineData), loader });
    });
  });
}

function Stage({ model, resetSignal, onReady, onError }) {
  const hostRef = useRef(null);
  const stateRef = useRef({ app: null, display: null, spine: null, loader: null, layout: initialLayout, baseScaleX: 1, baseScaleY: 1, scale: 1 });

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const canvas = document.createElement("canvas");
    canvas.className = "viewer-canvas";
    host.appendChild(canvas);
    const app = new PIXI.Application({ view: canvas, resizeTo: host, backgroundAlpha: 0, antialias: true, autoDensity: true, resolution: Math.min(devicePixelRatio || 1, 2) });
    stateRef.current.app = app;

    const recenter = () => {
      const state = stateRef.current;
      if (!state.display) return;
      state.spine?.update(0);
      const bounds = state.display.getLocalBounds();
      const layout = wallpaperMode
        ? calculateLayout({ screenWidth: app.screen.width, screenHeight: app.screen.height, contentWidth: bounds.width, contentHeight: bounds.height, ...state.layout })
        : { scaleX: Math.min(app.screen.width / Math.max(1, bounds.width), app.screen.height / Math.max(1, bounds.height)) * 0.86, scaleY: Math.min(app.screen.width / Math.max(1, bounds.width), app.screen.height / Math.max(1, bounds.height)) * 0.86, x: app.screen.width / 2, y: app.screen.height / 2 };
      state.baseScaleX = layout.scaleX;
      state.baseScaleY = layout.scaleY;
      state.scale = 1;
      state.display.scale.set(layout.scaleX, layout.scaleY);
      state.display.position.set(layout.x, layout.y);
    };
    stateRef.current.recenter = recenter;
    const resize = new ResizeObserver(recenter);
    resize.observe(host);

    let gesture = null;
    canvas.addEventListener("pointerdown", (event) => {
      const state = stateRef.current;
      if (!state.display) return;
      gesture = { pointerId: event.pointerId, previousX: event.clientX, previousY: event.clientY, moved: false };
      canvas.setPointerCapture(event.pointerId);
    });
    canvas.addEventListener("pointermove", (event) => {
      const state = stateRef.current;
      if (!gesture || gesture.pointerId !== event.pointerId || !state.display || (wallpaperMode && state.layout.locked)) return;
      const dx = event.clientX - gesture.previousX;
      const dy = event.clientY - gesture.previousY;
      gesture.moved ||= Math.hypot(dx, dy) > 1;
      if (wallpaperMode) {
        state.layout = normalizeLayout({ ...state.layout, offsetX: state.layout.offsetX + dx / Math.max(1, app.screen.width) * 100, offsetY: state.layout.offsetY + dy / Math.max(1, app.screen.height) * 100 });
        recenter();
      } else {
        state.display.x += dx;
        state.display.y += dy;
      }
      gesture.previousX = event.clientX;
      gesture.previousY = event.clientY;
    });
    const finish = (event) => {
      if (!gesture || gesture.pointerId !== event.pointerId) return;
      if (wallpaperMode && gesture.moved) window.webkit?.messageHandlers?.wallpaperTransform?.postMessage(stateRef.current.layout);
      gesture = null;
    };
    canvas.addEventListener("pointerup", finish);
    canvas.addEventListener("pointercancel", finish);
    canvas.addEventListener("wheel", (event) => {
      event.preventDefault();
      const state = stateRef.current;
      if (!state.display || (wallpaperMode && state.layout.locked)) return;
      const factor = event.deltaY > 0 ? 0.92 : 1.08;
      if (wallpaperMode) {
        state.layout = normalizeLayout({ ...state.layout, scale: state.layout.scale * factor });
        recenter();
        window.webkit?.messageHandlers?.wallpaperTransform?.postMessage(state.layout);
      } else {
        state.scale = Math.min(4, Math.max(0.2, state.scale * factor));
        state.display.scale.set(state.baseScaleX * state.scale, state.baseScaleY * state.scale);
      }
    }, { passive: false });

    const applyLayout = (next) => {
      stateRef.current.layout = normalizeLayout(next);
      recenter();
    };
    if (wallpaperMode) window.__setWallpaperTransform = applyLayout;
    return () => {
      resize.disconnect();
      if (window.__setWallpaperTransform === applyLayout) delete window.__setWallpaperTransform;
      stateRef.current.loader?.destroy?.();
      app.destroy(true, { children: true, texture: true, baseTexture: true });
    };
  }, []);

  useEffect(() => { stateRef.current.recenter?.(); }, [resetSignal]);

  useEffect(() => {
    let cancelled = false;
    async function open() {
      const state = stateRef.current;
      if (!model || !state.app) return;
      if (state.display) state.app.stage.removeChild(state.display);
      state.display?.destroy({ children: true });
      state.loader?.destroy?.();
      Object.assign(state, { display: null, spine: null, loader: null });
      try {
        const loaded = await loadSpine(model);
        if (cancelled) { loaded.spine.destroy({ children: true }); loaded.loader.destroy(); return; }
        const container = new PIXI.Container();
        loaded.spine.scale.y = -1;
        const names = (loaded.spine.spineData?.animations || []).map((animation) => animation.name);
        const initial = names.find((name) => /(^|[_-])(idle|loop)([_-]|$)/i.test(name)) || names[0];
        if (initial) loaded.spine.state.setAnimation(0, initial, true);
        loaded.spine.update(0);
        container.addChild(loaded.spine);
        const bounds = container.getLocalBounds();
        container.pivot.set(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
        Object.assign(state, { display: container, spine: loaded.spine, loader: loaded.loader });
        state.app.stage.addChild(container);
        state.recenter();
        onReady({ model, spine: loaded.spine, animations: names, current: initial });
      } catch (error) {
        if (!cancelled) onError(error);
      }
    }
    open();
    return () => { cancelled = true; };
  }, [model, onReady, onError]);

  return <div className="stage" ref={hostRef}>{!model && <div className="empty"><b>RHODES ISLAND</b><span>选择一项动态资源开始检查</span></div>}</div>;
}

function App() {
  const [catalog, setCatalog] = useState(null);
  const [query, setQuery] = useState("");
  const [selectedGroup, setSelectedGroup] = useState(null);
  const [selectedModel, setSelectedModel] = useState(null);
  const [runtime, setRuntime] = useState(null);
  const [error, setError] = useState("");
  const [resetSignal, setResetSignal] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/catalog").then((response) => response.ok ? response.json() : Promise.reject(new Error(`目录请求失败 (${response.status})`))).then((data) => {
      setCatalog(data);
      const allModels = data.groups.flatMap((group) => group.models.map((model) => ({ group, model })));
      const requested = allModels.find((item) => item.model.id === requestedModel);
      const group = requested?.group || data.groups[0] || null;
      setSelectedGroup(group);
      setSelectedModel(requested?.model || preferredModel(group));
    }).catch((reason) => setError(reason.message)).finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return catalog?.groups || [];
    return (catalog?.groups || []).filter((group) => `${group.id} ${group.name} ${group.skinName}`.toLowerCase().includes(needle));
  }, [catalog, query]);
  const onReady = useCallback((value) => { setRuntime(value); setError(""); }, []);
  const onError = useCallback((reason) => { setRuntime(null); setError(reason.message || String(reason)); }, []);
  const chooseGroup = (group) => { setSelectedGroup(group); setSelectedModel(preferredModel(group)); setRuntime(null); setError(""); };
  const play = (name) => { runtime?.spine.state.setAnimation(0, name, true); setRuntime((current) => current ? { ...current, current: name } : current); };

  return (
    <main className={wallpaperMode ? "app wallpaper" : "app"}>
      {!wallpaperMode && <aside className="library">
        <header><div className="mark">AK</div><div><strong>DYNCHARS</strong><small>SPINE 3.8 LAB</small></div></header>
        <label className="search"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索资源 ID / 角色名" /></label>
        <div className="library-meta"><span>{filtered.length} / {catalog?.stats.groups || 0} 组</span><span>{catalog?.stats.models || 0} 模型</span></div>
        <div className="group-list">
          {filtered.map((group) => <button key={group.id} className={selectedGroup?.id === group.id ? "group active" : "group"} onClick={() => chooseGroup(group)}>
            <span className="diamond">◇</span><span><strong>{group.name}</strong><small>{group.skinName || group.id}</small></span><em>{group.models.length}</em>
          </button>)}
        </div>
        <footer>未提供角色名时使用资源组 ID；可稍后通过 metadata JSON 补全。</footer>
      </aside>}

      <section className="viewer">
        {!wallpaperMode && <header className="topbar"><div><small>{selectedGroup?.id || "NO RESOURCE"}</small><h1>{selectedGroup?.name || "Arknights Dynamic Viewer"}</h1></div><div className="stats"><span>SPINE 3.8</span><span>{catalog?.stats.models || "—"} ASSETS</span></div></header>}
        {!wallpaperMode && selectedGroup && <nav className="variants">{selectedGroup.models.map((model) => <button key={model.id} className={selectedModel?.id === model.id ? "active" : ""} onClick={() => { setSelectedModel(model); setRuntime(null); }}><strong>{KIND_LABELS[model.kind] || model.kind}</strong><small>{model.id}</small></button>)}</nav>}
        <Stage model={selectedModel} resetSignal={resetSignal} onReady={onReady} onError={onError} />
        {!wallpaperMode && <aside className="controls">
          <div className="control-title"><span>MODEL INSPECTOR</span><button onClick={() => setResetSignal((value) => value + 1)}>重置视图</button></div>
          {selectedModel && <div className="facts"><div><small>模型 ID</small><code>{selectedModel.id}</code></div><div><small>资源类型</small><b>{KIND_LABELS[selectedModel.kind] || selectedModel.kind}</b></div><div><small>骨骼</small><b>{selectedModel.spineVersion} · {selectedModel.format}</b></div><div><small>纹理</small><b>{selectedModel.textureCount} 页</b></div></div>}
          <div className="action-title"><span>ANIMATIONS</span><em>{runtime?.animations.length || 0}</em></div>
          <div className="actions">{runtime?.animations.map((name) => <button key={name} className={runtime.current === name ? "active" : ""} onClick={() => play(name)}><span>▶</span>{name}</button>)}</div>
          <p className="hint">拖动画面调整位置 · 滚轮缩放 · 动作默认循环播放</p>
        </aside>}
        {!wallpaperMode && loading && <div className="notice">正在扫描本地资源…</div>}
        {error && <div className="error"><b>模型载入失败</b><span>{error}</span></div>}
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")).render(<App />);
