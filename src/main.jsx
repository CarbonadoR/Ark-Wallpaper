import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import * as PIXI from "pixi.js";
import { Spine, settings as spineSettings } from "pixi-spine";
import { calculateLayout, layoutFromSearch, normalizeLayout } from "./layout.js";
import { normalizeWallpaperBackground, wallpaperBackgroundFromSearch } from "./wallpaper-background.js";
import "./styles.css";

spineSettings.yDown = false;
const params = new URLSearchParams(location.search);
const wallpaperMode = params.get("wallpaper") === "1";
const requestedModel = params.get("model") || "";
const initialLayout = layoutFromSearch(params);
const initialWallpaperBackground = wallpaperBackgroundFromSearch(params);
const KIND_LABELS = { StaticE1: "精英一立绘", StaticE2: "精英二立绘", StaticSkin: "皮肤立绘", DynIllust: "动态立绘", DynPortrait: "动态头像", DynIllustStart: "入场动画", BattleFront: "战斗前景", BattleBack: "战斗背景" };
const KIND_CODES = { StaticE1: "ELITE I", StaticE2: "ELITE II", StaticSkin: "SKIN", DynIllust: "DYNILLUST", DynPortrait: "DYNPORTRAIT", DynIllustStart: "ENTRY", BattleFront: "BATTLE FRONT", BattleBack: "BATTLE BACK" };
const TYPE_FILTERS = [
  ["all", "ALL", "全部"],
  ["Static", "STATIC", "静态"],
  ["DynIllust", "ILLUST", "立绘"],
  ["DynPortrait", "PORTRAIT", "头像"],
  ["DynIllustStart", "ENTRY", "入场"],
  ["Battle", "BATTLE", "战斗"],
];

function modelMatchesFilter(model, filter) {
  return filter === "all" || model.kind === filter || (filter === "Static" && model.kind.startsWith("Static")) || (filter === "Battle" && model.kind.startsWith("Battle"));
}

function preferredModel(group) {
  return group?.models.find((model) => model.kind === "DynIllust")
    || group?.models.find((model) => model.kind === "StaticE2")
    || group?.models.find((model) => model.kind === "StaticE1")
    || group?.models[0]
    || null;
}

function idleAnimation(names) {
  return names.find((name) => /(^|[_-])(idle|loop)([_-]|$)/i.test(name)) || names[0] || null;
}

function interactionAnimation(names) {
  return names.find((name) => /^interact$/i.test(name))
    || names.find((name) => /(^|[_-])(interact|touch|tap|click)([_-]|$)/i.test(name))
    || names.find((name) => /(^|[_-])special([_-]|$)/i.test(name))
    || null;
}

function loadSpine(model) {
  return new Promise((resolve, reject) => {
    const loader = new PIXI.Loader();
    const key = `spine-${model.id}-${Date.now()}`;
    loader.onError.once((error) => reject(error));
    loader.add(key, model.skeletonUrl, {
      metadata: {
        spineAtlasFile: model.atlasUrl,
        // These PNG atlases contain straight alpha. Premultiply them while
        // uploading so linear filtering does not expose pale RGB edge pixels.
        // Straight-alpha pages are premultiplied during upload. The local API
        // marks already-premultiplied pages with `pma: true` in the atlas so
        // pixi-spine leaves those pixels untouched.
        imageMetadata: { alphaMode: PIXI.ALPHA_MODES.UNPACK },
      },
    });
    loader.load((_instance, resources) => {
      const resource = resources[key];
      if (!resource?.spineData) return reject(new Error("Spine 数据解析失败"));
      resolve({ spine: new Spine(resource.spineData), loader });
    });
  });
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`图片载入失败：${url}`));
    image.src = url;
  });
}

async function loadStaticImage(model) {
  const [color, alpha] = await Promise.all([loadImage(model.imageUrl), model.alphaUrl ? loadImage(model.alphaUrl) : null]);
  let source = color;
  if (alpha) {
    const canvas = document.createElement("canvas");
    canvas.width = color.naturalWidth;
    canvas.height = color.naturalHeight;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.drawImage(color, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    const maskCanvas = document.createElement("canvas");
    maskCanvas.width = canvas.width;
    maskCanvas.height = canvas.height;
    const maskContext = maskCanvas.getContext("2d", { willReadFrequently: true });
    maskContext.imageSmoothingEnabled = true;
    maskContext.drawImage(alpha, 0, 0, canvas.width, canvas.height);
    const mask = maskContext.getImageData(0, 0, canvas.width, canvas.height).data;
    for (let index = 0; index < pixels.data.length; index += 4) pixels.data[index + 3] = mask[index];
    context.putImageData(pixels, 0, 0);
    source = canvas;
  }
  const texture = PIXI.Texture.from(source);
  const sprite = new PIXI.Sprite(texture);
  sprite.anchor.set(0.5);
  return { sprite, texture };
}

function Stage({ model, resetSignal, onReady, onError }) {
  const hostRef = useRef(null);
  const stateRef = useRef({ app: null, display: null, spine: null, loader: null, texture: null, model: null, animations: [], idle: null, interaction: null, layout: initialLayout, baseScaleX: 1, baseScaleY: 1, scale: 1, onReady });
  stateRef.current.onReady = onReady;

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
      gesture = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, previousX: event.clientX, previousY: event.clientY, moved: false };
      canvas.setPointerCapture(event.pointerId);
    });
    canvas.addEventListener("pointermove", (event) => {
      const state = stateRef.current;
      if (!gesture || gesture.pointerId !== event.pointerId || !state.display) return;
      const dx = event.clientX - gesture.previousX;
      const dy = event.clientY - gesture.previousY;
      gesture.moved ||= Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY) > 4;
      gesture.previousX = event.clientX;
      gesture.previousY = event.clientY;
      if (wallpaperMode && state.layout.locked) return;
      if (wallpaperMode) {
        state.layout = normalizeLayout({ ...state.layout, offsetX: state.layout.offsetX + dx / Math.max(1, app.screen.width) * 100, offsetY: state.layout.offsetY + dy / Math.max(1, app.screen.height) * 100 });
        recenter();
      } else {
        state.display.x += dx;
        state.display.y += dy;
      }
    });
    const finish = (event) => {
      if (!gesture || gesture.pointerId !== event.pointerId) return;
      const moved = gesture.moved;
      gesture = null;
      const state = stateRef.current;
      if (wallpaperMode && moved) {
        window.webkit?.messageHandlers?.wallpaperTransform?.postMessage(state.layout);
        return;
      }
      if (moved || !state.spine || !state.interaction) return;
      const spine = state.spine;
      const entry = spine.state.setAnimation(0, state.interaction, false);
      if (state.idle && state.idle !== state.interaction) spine.state.addAnimation(0, state.idle, true, 0);
      state.onReady?.({ model: state.model, spine, animations: state.animations, current: state.interaction });
      entry.listener = {
        complete: () => {
          if (stateRef.current.spine === spine && state.idle) state.onReady?.({ model: state.model, spine, animations: state.animations, current: state.idle });
        },
      };
    };
    canvas.addEventListener("pointerup", finish);
    canvas.addEventListener("pointercancel", () => { gesture = null; });
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
      state.texture?.destroy(true);
      state.loader?.destroy?.();
      Object.assign(state, { display: null, spine: null, loader: null, texture: null, model: null, animations: [], idle: null, interaction: null });
      try {
        const loaded = model.mediaType === "image" ? await loadStaticImage(model) : await loadSpine(model);
        if (cancelled) {
          loaded.spine?.destroy({ children: true });
          loaded.sprite?.destroy({ texture: true, baseTexture: true });
          loaded.loader?.destroy();
          return;
        }
        const container = new PIXI.Container();
        if (loaded.spine) loaded.spine.scale.y = -1;
        const names = (loaded.spine?.spineData?.animations || []).map((animation) => animation.name);
        const initial = idleAnimation(names);
        const interaction = interactionAnimation(names);
        if (initial) loaded.spine.state.setAnimation(0, initial, true);
        loaded.spine?.update(0);
        container.addChild(loaded.spine || loaded.sprite);
        const bounds = container.getLocalBounds();
        container.pivot.set(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
        Object.assign(state, { display: container, spine: loaded.spine || null, loader: loaded.loader || null, texture: loaded.texture || null, model, animations: names, idle: initial, interaction });
        state.app.stage.addChild(container);
        state.recenter();
        onReady({ model, spine: loaded.spine || null, animations: names, current: initial });
      } catch (error) {
        if (!cancelled) onError(error);
      }
    }
    open();
    return () => { cancelled = true; };
  }, [model, onReady, onError]);

  return <div className="stage" ref={hostRef}>{!model && <div className="empty"><b>RHODES ISLAND</b><span>选择一项美术资源开始检查</span></div>}</div>;
}

function WallpaperBackground({ settings }) {
  return (
    <div className="wallpaper-background" style={{ backgroundColor: settings.color }} aria-hidden="true">
      {settings.imageUrls.length === 1 && <img className="wallpaper-background-image" src={settings.imageUrls[0]} alt="" />}
      {settings.imageUrls.length === 2 && <div className="wallpaper-background-panorama">
        {settings.imageUrls.map((url) => <img key={url} src={url} alt="" />)}
      </div>}
      <div className="wallpaper-background-spine" data-model-id={settings.spineId || undefined}></div>
    </div>
  );
}

function App() {
  const [catalog, setCatalog] = useState(null);
  const [query, setQuery] = useState("");
  const [kindFilter, setKindFilter] = useState("all");
  const [selectedGroup, setSelectedGroup] = useState(null);
  const [selectedModel, setSelectedModel] = useState(null);
  const [runtime, setRuntime] = useState(null);
  const [error, setError] = useState("");
  const [resetSignal, setResetSignal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [wallpaperBackground, setWallpaperBackground] = useState(initialWallpaperBackground);
  const searchRef = useRef(null);

  useEffect(() => {
    if (!wallpaperMode) return undefined;
    const applyWallpaperBackground = (next) => setWallpaperBackground((current) => normalizeWallpaperBackground({ ...current, ...next }));
    window.__setWallpaperBackground = applyWallpaperBackground;
    return () => {
      if (window.__setWallpaperBackground === applyWallpaperBackground) delete window.__setWallpaperBackground;
    };
  }, []);

  useEffect(() => {
    fetch("/api/catalog").then((response) => response.ok ? response.json() : Promise.reject(new Error(`目录请求失败 (${response.status})`))).then((data) => {
      setCatalog(data);
      const allModels = data.groups.flatMap((group) => group.models.map((model) => ({ group, model })));
      const requested = allModels.find((item) => item.model.id === requestedModel);
      const fallback = allModels.find((item) => item.model.kind === "DynIllust") || allModels[0];
      const group = requested?.group || fallback?.group || null;
      setSelectedGroup(group);
      setSelectedModel(requested?.model || preferredModel(group));
    }).catch((reason) => setError(reason.message)).finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (catalog?.groups || []).filter((group) =>
      group.models.some((model) => modelMatchesFilter(model, kindFilter))
      && (!needle || `${group.id} ${group.name} ${group.skinName} ${(group.aliases || []).join(" ")}`.toLowerCase().includes(needle)),
    );
  }, [catalog, query, kindFilter]);
  const visibleModels = useMemo(() => {
    const models = selectedGroup?.models || [];
    const matching = models.filter((model) => modelMatchesFilter(model, kindFilter));
    return matching.length ? matching : models;
  }, [selectedGroup, kindFilter]);
  const onReady = useCallback((value) => { setRuntime(value); setError(""); }, []);
  const onError = useCallback((reason) => { setRuntime(null); setError(reason.message || String(reason)); }, []);
  const chooseGroup = (group) => {
    const matching = group.models.filter((model) => modelMatchesFilter(model, kindFilter));
    setSelectedGroup(group);
    setSelectedModel(matching[0] || preferredModel(group));
    setRuntime(null);
    setError("");
    setLibraryOpen(false);
  };
  const chooseFilter = (filter) => {
    setKindFilter(filter);
    if (!selectedGroup) return;
    const matching = selectedGroup.models.filter((model) => modelMatchesFilter(model, filter));
    if (matching.length && !matching.some((model) => model.id === selectedModel?.id)) {
      setSelectedModel(matching[0]);
      setRuntime(null);
    }
  };
  const play = (name) => { runtime?.spine.state.setAnimation(0, name, true); setRuntime((current) => current ? { ...current, current: name } : current); };
  const copyModelId = async () => {
    if (!selectedModel) return;
    await navigator.clipboard.writeText(selectedModel.id);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === "/" && document.activeElement?.tagName !== "INPUT") {
        event.preventDefault();
        searchRef.current?.focus();
      }
      if (event.key.toLowerCase() === "r" && document.activeElement?.tagName !== "INPUT") setResetSignal((value) => value + 1);
      if (event.key === "Escape") { setLibraryOpen(false); setInspectorOpen(false); searchRef.current?.blur(); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <main className={wallpaperMode ? "app wallpaper" : "app"}>
      {!wallpaperMode && <aside className={`library ${libraryOpen ? "open" : ""}`}>
        <header className="brand-block">
          <div className="brand-word">ARKNIGHTS</div>
          <div className="brand-caption"><strong>RHODES ISLAND</strong><small>ARTWORK ASSET TERMINAL</small></div>
          <button className="panel-close" onClick={() => setLibraryOpen(false)} aria-label="关闭资源目录">×</button>
        </header>
        <div className="section-heading"><span>01</span><div><strong>ASSET INDEX</strong><small>资源目录</small></div></div>
        <label className="search"><span>⌕</span><input ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="检索资源 ID / 角色名" />{query && <button onClick={() => setQuery("")} aria-label="清空搜索">×</button>}<kbd>/</kbd></label>
        <div className="type-filters" aria-label="资源类型筛选">
          {TYPE_FILTERS.map(([key, english, chinese]) => <button key={key} className={kindFilter === key ? "active" : ""} onClick={() => chooseFilter(key)}><strong>{english}</strong><small>{chinese}</small></button>)}
        </div>
        <div className="library-meta"><span><b>{String(filtered.length).padStart(2, "0")}</b> / {String(catalog?.stats.groups || 0).padStart(2, "0")} GROUPS</span><span>{catalog?.stats.models || 0} MODELS</span></div>
        <div className="group-list">
          {filtered.map((group) => <button key={group.id} className={selectedGroup?.id === group.id ? "group active" : "group"} onClick={() => chooseGroup(group)}>
            <span className="group-index">{String((catalog?.groups || []).indexOf(group) + 1).padStart(2, "0")}</span><span><strong>{group.name}</strong><small>{group.skinName || group.id}</small></span><em>{group.models.length}<i>›</i></em>
          </button>)}
          {!loading && !filtered.length && <div className="empty-results"><b>NO RESULT</b><span>没有符合当前条件的资源</span><button onClick={() => { setQuery(""); chooseFilter("all"); }}>清除筛选</button></div>}
        </div>
        <footer><span>LOCAL DATABASE</span><b>{catalog?.stats.issues ? `${catalog.stats.issues} ISSUES` : "SYSTEM NORMAL"}</b><small>角色元数据缺失时显示稳定资源 ID</small></footer>
      </aside>}

      <section className="viewer">
        {wallpaperMode && <WallpaperBackground settings={wallpaperBackground} />}
        {!wallpaperMode && <header className="topbar">
          <button className="mobile-trigger" onClick={() => setLibraryOpen(true)} aria-label="打开资源目录"><i></i><i></i><i></i></button>
          <div className="title-block"><div className="eyebrow"><span>OPERATOR / ARTWORK ARCHIVE</span><small>{selectedGroup?.id || "NO RESOURCE"}</small></div><h1>{selectedGroup?.name || "Arknights Artwork Viewer"}</h1><p>{selectedGroup?.skinName || "LOCAL ARTWORK INSPECTION SYSTEM"}</p></div>
          <nav className="top-nav" aria-label="页面状态"><span className="active"><b>INDEX</b><small>索引</small></span><span><b>OPERATOR</b><small>干员</small></span><span><b>ANIMATION</b><small>动作</small></span></nav>
          <div className="system-stats"><span><i></i>ONLINE</span><b>{catalog?.stats.models || "—"}</b><small>ASSETS</small></div>
          <button className="mobile-inspector" onClick={() => setInspectorOpen(true)} aria-label="打开模型信息">i</button>
        </header>}
        {!wallpaperMode && selectedGroup && <nav className="variants"><div className="variant-label"><b>02</b><span>DISPLAY MODE<small>展示模式</small></span></div>{visibleModels.map((model, index) => <button key={model.id} className={selectedModel?.id === model.id ? "active" : ""} onClick={() => { setSelectedModel(model); setRuntime(null); }}><em>{String(index + 1).padStart(2, "0")}</em><span><strong>{KIND_CODES[model.kind] || model.kind.toUpperCase()}</strong><small>{KIND_LABELS[model.kind] || model.kind}</small></span></button>)}</nav>}
        <Stage model={selectedModel} resetSignal={resetSignal} onReady={onReady} onError={onError} />
        {!wallpaperMode && <div className="viewport-frame" aria-hidden="true"><i></i><i></i><i></i><i></i><span>LIVE VIEW</span></div>}
        {!wallpaperMode && <div className="stage-hint">{selectedModel?.mediaType === "spine" && <><span>CLICK</span> 播放交互 <i></i></>}<span>DRAG</span> 移动画面 <i></i><span>SCROLL</span> 调整缩放 <i></i><span>R</span> 复位</div>}
        {!wallpaperMode && <aside className={`controls ${inspectorOpen ? "open" : ""}`}>
          <div className="inspector-head"><div className="section-heading"><span>03</span><div><strong>MODEL CONTROL</strong><small>模型控制</small></div></div><button className="panel-close" onClick={() => setInspectorOpen(false)} aria-label="关闭模型信息">×</button></div>
          <div className="control-title"><span>MODEL PROFILE</span><button onClick={() => setResetSignal((value) => value + 1)}>↺ RESET</button></div>
          {selectedModel && <div className="facts"><div className="wide"><small>MODEL IDENTIFICATION</small><code>{selectedModel.id}</code><button onClick={copyModelId}>{copied ? "COPIED" : "COPY"}</button></div><div><small>ASSET TYPE</small><b>{KIND_LABELS[selectedModel.kind] || selectedModel.kind}</b></div><div><small>RUNTIME</small><b>{selectedModel.mediaType === "image" ? "STATIC IMAGE" : `SPINE ${selectedModel.spineVersion}`}</b></div><div><small>DATA FORMAT</small><b>{selectedModel.format.toUpperCase()}</b></div><div><small>{selectedModel.mediaType === "image" ? "RESOLUTION" : "TEXTURE"}</small><b>{selectedModel.mediaType === "image" ? `${selectedModel.width || "—"} × ${selectedModel.height || "—"}` : `${selectedModel.textureCount} PAGE${selectedModel.textureCount > 1 ? "S" : ""}`}</b></div></div>}
          {selectedModel?.mediaType === "spine" ? <><div className="action-title"><span><b>ANIMATION SET</b><small>动作列表</small></span><em>{String(runtime?.animations.length || 0).padStart(2, "0")}</em></div>
            <div className="actions">{runtime?.animations.map((name, index) => <button key={name} className={runtime.current === name ? "active" : ""} onClick={() => play(name)}><em>{String(index + 1).padStart(2, "0")}</em><span><b>{name}</b><small>{runtime.current === name ? "PLAYING / LOOP" : "READY"}</small></span><i>▶</i></button>)}</div>
            <p className="hint"><span></span> 动作以循环模式播放 / LOOP ENABLED</p></> : <div className="static-info"><b>STATIC ARTWORK</b><span>静态立绘支持拖动、缩放与壁纸布局控制</span></div>}
        </aside>}
        {!wallpaperMode && loading && <div className="notice"><i></i><div><b>CONNECTING DATABASE</b><span>正在扫描本地美术资源</span></div></div>}
        {error && <div className="error"><b>模型载入失败</b><span>{error}</span></div>}
        {!wallpaperMode && (libraryOpen || inspectorOpen) && <button className="panel-scrim" aria-label="关闭面板" onClick={() => { setLibraryOpen(false); setInspectorOpen(false); }}></button>}
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")).render(<App />);
