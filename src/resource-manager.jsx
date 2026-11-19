import React, {useEffect,useState} from 'react';

const size=n=>`${((n||0)/1e9).toFixed(2)} GB`;
export function ResourceManager(){
  const [status,setStatus]=useState({}),[url,setURL]=useState(''),[error,setError]=useState(''),[working,setWorking]=useState(false);
  const read=()=>fetch('/api/resources/status').then(r=>r.json()).then(setStatus).catch(()=>setError('本地资源服务无法连接。'));
  useEffect(()=>{fetch('/api/resources/status').then(r=>r.json()).then(s=>{setStatus(s);setURL(s.source||'');});const timer=setInterval(read,1000);return()=>clearInterval(timer);},[]);
  const action=async(path,body={},method='POST')=>{
    setError('');setWorking(true);
    try{const response=await fetch('/api/resources/'+path,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const value=await response.json();if(!response.ok)throw Error(value.error||'操作未完成');await read();}
    catch(e){setError(e.message);}finally{setWorking(false);}
  };
  const busy=working||status.busy,p=status.progress;
  return <main className="resource-manager"><a href="/">← 返回查看器</a><h1>资源下载与更新</h1><p>完整目录始终可浏览。首次打开人物时自动缓存，已下载的人物可离线使用。</p>
    <label>公开资源服务地址<input value={url} onChange={e=>setURL(e.target.value)} placeholder="https://资源服务地址/" disabled={busy}/></label>
    <div className="resource-actions"><button disabled={busy} onClick={()=>action('settings',{url},'PUT')}>保存地址</button><button disabled={busy||!status.source} onClick={()=>action('check')}>检查更新</button></div>
    <p>{status.packs||0} 个资源包 · 已缓存 {status.cachedPacks||0} 个 · 全部约 {size(status.totalBytes)}（共享文件会复用）</p>
    {status.release&&<p>资源版本：{status.release}</p>}
    <div className="resource-actions"><button disabled={busy||!status.packs} onClick={()=>action('download',{mode:'cached'})}>更新已缓存资源</button><button disabled={busy||!status.packs} onClick={()=>action('download',{mode:'all'})}>下载全部精简资源</button>{status.busy&&<button onClick={()=>action('cancel')}>取消下载</button>}</div>
    {p&&<div aria-live="polite"><p>{p.name} · {size(p.receivedBytes)} / {size(p.expectedBytes)}</p><progress max={p.expectedBytes||1} value={p.receivedBytes||0}/>{p.totalPacks&&<p>已完成 {p.completedPacks} / {p.totalPacks} 个资源包</p>}</div>}
    {(error||status.error)&&<p role="alert">{error||status.error}</p>}
    <p>下载完成后返回或刷新查看器即可使用新资源。取消不会移除已经完成的缓存。</p>
  </main>;
}
