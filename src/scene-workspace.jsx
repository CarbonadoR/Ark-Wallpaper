import React, { useEffect, useRef, useState } from "react";
import { MAX_SCENE_LAYERS, moveSceneLayer, normalizeScene, sceneGeometry } from "./scene.js";

// Unsaved work survives model switches in this viewer, without changing wallpaper.
const drafts = new Map();
const labels = { contain: "完整显示", cover: "等比覆盖", width: "宽度铺满", height: "高度铺满", stretch: "拉伸铺满" };

function SceneNumber({ value, label, onChange, ...limits }) {
  const [text, setText] = useState(String(value));
  const focused = useRef(false);
  useEffect(() => { if (!focused.current) setText(String(Number(value.toFixed(3)))); }, [value]);
  return <input type="number" aria-label={label} {...limits} value={text}
    onFocus={() => { focused.current = true; }}
    onBlur={() => { focused.current = false; setText(String(Number(value.toFixed(3)))); }}
    onChange={event => { const raw = event.target.value; setText(raw); if (raw !== "" && Number.isFinite(Number(raw))) onChange(Number(raw)); }} />;
}

export function SceneWorkspace({ model, editing, onClose, wallpaper }) {
  const [assets, setAssets] = useState([]);
  const [preset, setPreset] = useState({ layers: [] });
  const [selected, setSelected] = useState("");
  const [revision, setRevision] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const [source, setSource] = useState("outfit");
  const [query, setQuery] = useState("");
  const [failed, setFailed] = useState(new Set());
  const [size, setSize] = useState({ width: 1, height: 1 });
  const viewport = useRef(null);
  const drag = useRef(null);
  const current = useRef({ preset, revision, dirty, saving });
  current.current = { preset, revision, dirty, saving };
  const reload = useRef(null);

  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(viewport.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let disposed = false;
    let serial = 0;
    const controller = new AbortController();
    const load = async (discard = false) => {
      const request = ++serial;
      try {
        const response = await fetch(`/api/models/${model.id}/scene`, { signal: controller.signal });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "场景读取失败");
        if (disposed || request !== serial) return;
        setAssets(data.assets); setReady(true);
        if (!discard && current.current.dirty) {
          if (data.revision !== current.current.revision) setError("场景已在其他窗口更新。当前草稿已保留，请重新载入后编辑。");
          return;
        }
        const draft = !wallpaper && !discard ? drafts.get(model.id) : null;
        const value = draft?.preset || normalizeScene(data.preset);
        setPreset(value); setRevision(draft?.revision || data.revision); setDirty(Boolean(draft));
        setSelected(previous => value.layers.some(l => l.id === previous) ? previous : value.layers.at(-1)?.id || "");
        setError(draft && draft.revision !== data.revision ? "场景已在其他窗口更新。当前草稿已保留，请重新载入后编辑。" : "");
        if (discard) drafts.delete(model.id);
      } catch (reason) { if (!disposed && reason.name !== "AbortError") setError(reason.message); }
    };
    reload.current = load;
    load();
    const events = new EventSource("/api/scene-events");
    events.onmessage = event => {
      if ((event.data === "ready" || event.data === model.id) && !current.current.saving) load();
    };
    // Reconnecting EventSource sends "ready", resynchronizing changes missed in sleep.
    return () => { disposed = true; controller.abort(); events.close(); };
  }, [model.id, wallpaper]);

  const change = value => {
    const next = normalizeScene(value);
    current.current = { ...current.current, preset: next, dirty: true };
    drafts.set(model.id, { preset: next, revision: current.current.revision });
    setPreset(next); setDirty(true);
  };
  const update = (id, patch) => change({ layers: current.current.preset.layers.map(layer => layer.id === id ? { ...layer, ...patch } : layer) });
  const save = async () => {
    const sent = current.current.preset;
    setSaving(true); current.current.saving = true;
    setError("");
    try {
      const response = await fetch(`/api/models/${model.id}/scene`, { method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preset: sent, revision: current.current.revision }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "场景保存失败");
      setRevision(data.revision); current.current.revision = data.revision;
      if (current.current.preset === sent) { setDirty(false); current.current.dirty = false; drafts.delete(model.id); }
      else drafts.set(model.id, { preset: current.current.preset, revision: data.revision });
    } catch (reason) { setError(reason.message); }
    finally { setSaving(false); current.current.saving = false; }
  };
  const add = asset => {
    if (preset.layers.length >= MAX_SCENE_LAYERS) return;
    const id = `layer-${crypto.randomUUID()}`;
    change({ layers: [...preset.layers, { id, assetId: asset.id }] }); setSelected(id);
  };
  const reorder = (id, step) => {
    const layers = [...preset.layers]; const from = layers.findIndex(l => l.id === id); const to = from + step;
    if (to < 0 || to >= layers.length) return;
    [layers[from], layers[to]] = [layers[to], layers[from]]; change({ layers });
  };
  const active = preset.layers.find(layer => layer.id === selected);
  const activeAsset = assets.find(asset => asset.id === active?.assetId);
  const geometry = activeAsset ? sceneGeometry(active, activeAsset, size.width, size.height) : null;
  const image = (asset, preview = false) => <div className={preview ? "scene-thumbnail" : "scene-image-strip"}>
    {asset.imageUrls.map(url => <img key={url} src={url} alt="" draggable="false" loading={preview ? "lazy" : "eager"}
      onError={() => setFailed(previous => new Set([...previous, asset.id]))} />)}
  </div>;

  return <>
    <div ref={viewport} className="scene-viewport" aria-hidden="true" data-scene-model={model.id}>
      {preset.layers.map(layer => {
        const asset = assets.find(a => a.id === layer.assetId);
        return asset && layer.enabled && <div key={layer.id} className="scene-image-layer" data-scene-layer={layer.id}
          style={{ ...sceneGeometry(layer, asset, size.width, size.height), opacity: layer.opacity, mixBlendMode: layer.blend }}>{image(asset)}</div>;
      })}
    </div>
    {editing && <>
      <div className="scene-handles" aria-label="场景拖动区域">
        {active?.enabled && geometry && <div className="scene-selection" style={geometry} role="region" aria-label="拖动选中图层，滚轮缩放"
          onPointerDown={event => { if (event.button !== 0) return; event.preventDefault(); event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, layer: active }; }}
          onPointerMove={event => { const d = drag.current; if (!d || d.id !== event.pointerId) return; event.stopPropagation(); update(d.layer.id, moveSceneLayer(d.layer, event.clientX - d.x, event.clientY - d.y, size.width, size.height)); }}
          onPointerUp={event => { if (drag.current?.id === event.pointerId) drag.current = null; }} onPointerCancel={() => { drag.current = null; }}
          onWheel={event => { event.stopPropagation(); update(active.id, { scale: active.scale * (event.deltaY > 0 ? .92 : 1.08) }); }}>
          <span>{activeAsset.name}</span>
        </div>}
      </div>
      <aside className="scene-editor" aria-label="场景编辑器">
        <header><div><small>SCENE COMPOSITOR</small><h2>场景编辑</h2></div><button onClick={onClose} aria-label="关闭场景编辑">×</button></header>
        <div className="scene-editor-scroll">
          <p className="scene-description">将背景组合在角色后方。选中图层后可拖动、滚轮缩放；保存后同步到该模型的壁纸。</p>
          {model.scene?.meshCount > 0 && <p className="scene-detection">此造型尚无可靠的自动定位数据。部分图片是打包纹理，可选“桌面背景”替代；网格与特效暂不还原。</p>}
          {error && <p className="scene-error" role="alert">{error}</p>}
          <div className="scene-section-title"><h3>图层</h3><span>{preset.layers.length} / {MAX_SCENE_LAYERS}</span></div>
          {!preset.layers.length && <p className="scene-empty">从下方素材库添加第一张背景</p>}
          <ol className="scene-layer-list">{[...preset.layers].reverse().map(layer => {
            const asset = assets.find(a => a.id === layer.assetId);
            return <li key={layer.id} className={selected === layer.id ? "selected" : ""}>
              <button className="scene-layer-name" onClick={() => setSelected(layer.id)} title={asset?.name}>{asset?.name || "素材已移除"}</button>
              <input type="checkbox" aria-label={`显示 ${asset?.name || "图层"}`} checked={layer.enabled} onChange={e => update(layer.id, { enabled: e.target.checked })} />
              <button aria-label="上移图层" disabled={preset.layers.at(-1)?.id === layer.id} onClick={() => reorder(layer.id, 1)}>↑</button>
              <button aria-label="下移图层" disabled={preset.layers[0]?.id === layer.id} onClick={() => reorder(layer.id, -1)}>↓</button>
              <button aria-label="删除图层" onClick={() => { change({ layers: preset.layers.filter(l => l.id !== layer.id) }); if (selected === layer.id) setSelected(""); }}>×</button>
            </li>;
          })}</ol>
          {active && <div className="scene-transform">
            <label>适配<select value={active.fit} onChange={e => update(active.id, { fit: e.target.value })}>{Object.entries(labels).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label>
            {[["x", "水平偏移 (%)", -200, 200, 1], ["y", "垂直偏移 (%)", -200, 200, 1], ["scale", "缩放", .05, 8, .05], ["opacity", "不透明度", 0, 1, .05]].map(([key, label, min, max, step]) =>
              <label key={key}>{label}<SceneNumber key={active.id} label={label} value={active[key]} min={min} max={max} step={step} onChange={value => update(active.id, { [key]: value })} /></label>)}
            <label>混合<select value={active.blend} onChange={e => update(active.id, { blend: e.target.value })}><option value="normal">正常</option><option value="screen">滤色（亮光）</option><option value="multiply">正片叠底</option></select></label>
            <button onClick={() => update(active.id, { x: 0, y: 0, scale: 1, opacity: 1, fit: "contain", blend: "normal" })}>复位选中图层</button>
            {(!activeAsset || failed.has(active.assetId)) && <p className="scene-error">该图片不可用，请更换素材或移除此图层。</p>}
          </div>}
          <div className="scene-section-title"><h3>素材库</h3><span>点击添加</span></div>
          <div className="scene-library-filter"><select aria-label="素材来源" value={source} onChange={e => setSource(e.target.value)}><option value="outfit">当前造型图片</option><option value="background">桌面背景</option></select>
            <input aria-label="搜索场景图片" placeholder="搜索图片名，如 bg" value={query} onChange={e => setQuery(e.target.value)} /></div>
          <div className="scene-assets">{assets.filter(a => a.source === source && a.name.toLowerCase().includes(query.toLowerCase())).map(asset =>
            <button key={asset.id} onClick={() => add(asset)} disabled={!ready || preset.layers.length >= MAX_SCENE_LAYERS} title={asset.name}>
              {image(asset, true)}<span>{asset.name}</span><small>{asset.width} × {asset.height}</small>
            </button>)}</div>
          {ready && !assets.some(a => a.source === source) && <p className="scene-empty">没有可用图片，可切换素材来源</p>}
        </div>
        <footer><span role="status">{saving ? "正在保存…" : dirty ? "草稿 · 尚未保存" : ready ? "已与保存配置一致" : "正在读取…"}</span>
          <div><button disabled={saving} onClick={() => reload.current?.(true)}>重新载入</button><button className="scene-save" disabled={!ready || !dirty || saving} onClick={save}>保存并同步壁纸</button></div></footer>
      </aside>
    </>}
    {wallpaper && error && <p className="scene-wallpaper-error">场景暂不可用，角色仍可正常显示。</p>}
  </>;
}
