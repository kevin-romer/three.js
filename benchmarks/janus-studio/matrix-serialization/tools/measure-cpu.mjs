// Runs inside the page; no application sources are embedded in this module.
export async function measureMap({warmup=120,frames=300,correctness=true,diagnostics=false}={}){
 const bench=globalThis.__threeBench,harness=globalThis.__illustrationHarness;
 const map=harness?.map??globalThis.__benchMaps?.find(m=>{try{return !m.getNativeLifetime().signal.aborted&&m.getNativeFrame()}catch{return false}});
 if(!map||!bench)throw Error('A live nonempty native map and engine observer are required');
 const gl=map.getCanvas().getContext('webgl2'),ext=gl.getExtension('WEBGL_debug_renderer_info');
 const device=ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER);
 if(/SwiftShader|llvmpipe|software/i.test(device))throw Error('Software GPU cannot qualify a hardware run');
 const initial=harness?[...harness.controller.entries].map(([id,e])=>({id,uuid:e.mesh.uuid,level:e.compiled.level})):[];
 if(harness&&(initial.length===0||initial.filter(e=>e.level==='full').length<3))throw Error('Expected retained detailed building scene');
 const center=map.getCenter(),base={longitude:center.lng,latitude:center.lat,zoom:map.getZoom(),bearing:map.getBearing(),pitch:map.getPitch()};
 const path=index=>({center:[base.longitude+Math.sin(index*.037)*.00004,base.latitude+Math.cos(index*.041)*.000025],zoom:base.zoom+(harness?(Math.sin(index*.029)+1)*.02:Math.sin(index*.029)*.025),bearing:base.bearing+Math.sin(index*.031)*.35,pitch:base.pitch+(harness?Math.sin(index*.023)*.3:0)});
 const summaries=[],pixels=[],longTasks=[],calls={},restore=[];let previousEnd=null;
 const longTaskSupported=typeof PerformanceObserver==='function'&&PerformanceObserver.supportedEntryTypes?.includes('longtask');
 const observer=longTaskSupported?new PerformanceObserver(list=>{for(const e of list.getEntries())longTasks.push(e.duration)}):null;
 const uniformBytes={uniform1f:4,uniform2f:8,uniform3f:12,uniform4f:16,uniform1i:4,uniform2i:8,uniform3i:12,uniform4i:16};
 const instrument=()=>{
  const names=['createProgram','deleteProgram','linkProgram','getProgramInfoLog','getShaderInfoLog','createBuffer','deleteBuffer','createTexture','deleteTexture','createVertexArray','deleteVertexArray','bufferData','bufferSubData','texImage2D','texSubImage2D',...Object.keys(uniformBytes),'uniform1fv','uniform2fv','uniform3fv','uniform4fv','uniformMatrix3fv','uniformMatrix4fv'];
  for(const name of names){const original=gl[name];if(typeof original!=='function')continue;gl[name]=function(...args){const row=calls[name]??={calls:0,bytes:0};row.calls++;if(name==='bufferData'||name==='bufferSubData'){const value=args[name==='bufferData'?1:2];let bytes=typeof value==='number'?value:value?.byteLength??0;if(ArrayBuffer.isView(value)){const index=name==='bufferData'?3:3,offset=args[index]??0,length=args[index+1];if(typeof length==='number'&&length>0)bytes=length*(value.BYTES_PER_ELEMENT??1);else bytes-=offset*(value.BYTES_PER_ELEMENT??1)}row.bytes+=bytes}else if(name==='texImage2D'||name==='texSubImage2D'){row.bytes=null;row.byteStatus='not-measured-if-called'}else if(uniformBytes[name])row.bytes+=uniformBytes[name];else if(name.startsWith('uniform'))row.bytes+=args.at(-1)?.byteLength??0;return original.apply(this,args)};restore.push(()=>gl[name]=original)}
 };
 const percentile=(a,p)=>{const sorted=[...a].sort((a,b)=>a-b);return sorted[Math.max(0,Math.ceil(sorted.length*p)-1)]??null};
 const recordPixel=async bytes=>{
  let colored=0,nonzeroAlpha=0;for(let i=0;i<bytes.length;i+=4){if(bytes[i]||bytes[i+1]||bytes[i+2])colored++;if(bytes[i+3])nonzeroAlpha++}
  const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');
  if(colored===0||nonzeroAlpha===0)throw Error('Empty framebuffer cannot qualify correctness');
  return{sha256:hash,colored,nonzeroAlpha,width:gl.drawingBufferWidth,height:gl.drawingBufferHeight};
 };
 async function present(index,{timed=false,capture=false}={}){
  const camera=path(index);bench.samples.length=0;bench.resetSamples.length=0;bench.active=timed;
  let actionMs=0;
  return new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>{map.off('render',onRender);bench.active=false;reject(Error('Timed out waiting for a current nonempty rendered frame at step '+index))},5000);
   const onRender=()=>{
    let frame;try{frame=map.getNativeFrame()}catch{return}
    if(!frame||Math.abs(frame.camera.longitude-camera.center[0])>1e-9||Math.abs(frame.camera.latitude-camera.center[1])>1e-9||Math.abs(frame.camera.zoom-camera.zoom)>1e-9||Math.abs(frame.camera.bearing-camera.bearing)>1e-9||Math.abs(frame.camera.pitch-camera.pitch)>1e-9)return;
    if(harness&&initial.some(({id,uuid,level})=>harness.controller.entries.get(id)?.mesh.uuid!==uuid||harness.controller.entries.get(id)?.compiled.level!==level||(level==='full'&&!harness.controller.entries.get(id)?.mesh.visible))){clearTimeout(timer);map.off('render',onRender);bench.active=false;reject(Error('Retained building identity or visible detail changed in a rendered frame'));return}
    const end=performance.now(),renderMs=bench.samples.reduce((n,s)=>n+s.ms,0),resetMs=bench.resetSamples.reduce((n,s)=>n+s,0),draws=bench.samples.reduce((n,s)=>n+s.calls,0),triangles=bench.samples.reduce((n,s)=>n+s.triangles,0);
    let bytes;if(capture){bytes=new Uint8Array(gl.drawingBufferWidth*gl.drawingBufferHeight*4);gl.readPixels(0,0,gl.drawingBufferWidth,gl.drawingBufferHeight,gl.RGBA,gl.UNSIGNED_BYTE,bytes)}
    bench.active=false;clearTimeout(timer);map.off('render',onRender);
    if(timed){if(draws===0||triangles===0){reject(Error('Empty geometry cannot qualify a benchmark frame'));return}summaries.push({renderMs,resetMs,engineMs:renderMs+resetMs,actionMs,frameIntervalMs:previousEnd===null?null:end-previousEnd,draws,triangles,renderCalls:bench.samples.length});previousEnd=end}
    if(bytes)recordPixel(bytes).then(resolve,reject);else resolve();
   };
   map.on('render',onRender);
   try{const start=performance.now();map.jumpTo(camera);map.triggerRepaint();actionMs=performance.now()-start}catch(error){clearTimeout(timer);map.off('render',onRender);bench.active=false;reject(error)}
  });
 }
 try{
  for(let i=0;i<warmup;i++)await present(i-warmup);
  if(correctness)for(const step of [0,73,151])pixels.push({step,...await present(step,{capture:true})});
  if(diagnostics)instrument();
  observer?.observe({type:'longtask',buffered:false});
  await globalThis.__threePerfBoundary('start');const started=performance.now();for(let i=0;i<frames;i++)await present(i,{timed:true});const elapsedMs=performance.now()-started;await globalThis.__threePerfBoundary('end');
  observer?.disconnect();for(const fn of restore)fn();restore.length=0;
  const glError=gl.getError();if(glError)throw Error('Unexpected GL error '+glError);
  const retained=harness?initial.filter(({id,uuid})=>harness.controller.entries.get(id)?.mesh.uuid===uuid).length:null;
  const hidden=harness?initial.filter(({id,level})=>level==='full'&&!harness.controller.entries.get(id)?.mesh.visible).length:null;
  if(harness&&(retained!==initial.length||hidden!==0))throw Error('Expected building meshes or visible detail were lost');
  const metrics={};for(const name of ['engineMs','renderMs','resetMs','actionMs','frameIntervalMs']){const values=summaries.map(s=>s[name]).filter(Number.isFinite);metrics[name]={p50:percentile(values,.5),p95:percentile(values,.95),p99:percentile(values,.99),max:Math.max(...values)}}
  return{device,backend:'WebGL2',revision:bench.revision,base,warmup,frames:summaries.length,elapsedMs,metrics,summaries,pixels,counts:calls,longTasks:longTaskSupported?longTasks:null,longTaskSupport:longTaskSupported?'supported':'unsupported',glError,models:initial.length,fullModels:initial.filter(e=>e.level==='full').length,motionVersion:2,retained,hidden,declaredGeometryBytes:harness?{cpu:harness.controller.snapshot().status.cpuBytes,gpu:harness.controller.snapshot().status.gpuBytes}:null,programs:bench.renderers.map(r=>({total:r.info.programs.length,inactive:r.info.programs.filter(p=>p.usedTimes===0).length,geometries:r.info.memory.geometries,textures:r.info.memory.textures})),heapUsedApprox:performance.memory?.usedJSHeapSize??null};
 }finally{bench.active=false;observer?.disconnect();for(const fn of restore)fn()}
}
