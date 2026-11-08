// Diagnostic only. Weak object tracking must not retain destroyed GL contexts.
export function instrumentResources(){
 const counts={},restore=[],contexts=new WeakMap(),references=[],objects=new WeakMap();
 function retire(record){for(const entry of record.rows.values())if(!entry.closed){entry.global.contextLossReleased+=entry.live;entry.global.live-=entry.live;entry.live=0;entry.closed=true}}
 function context(gl){let record=contexts.get(gl);if(!record){record={rows:new Map()};contexts.set(gl,record);references.push({weak:new WeakRef(gl),record});gl.canvas.addEventListener('webglcontextlost',()=>retire(record),{once:true})}return record}
 function reconcile(){for(const entry of references){const gl=entry.weak.deref();if(!gl||gl.isContextLost())retire(entry.record)}}
 for(const proto of [globalThis.WebGLRenderingContext?.prototype,globalThis.WebGL2RenderingContext?.prototype].filter(Boolean))for(const type of ['Program','Shader','Buffer','Texture','VertexArray','Framebuffer','Renderbuffer','Query','Sampler','TransformFeedback','Sync']){
  const create=type==='Sync'?'fenceSync':'create'+type,remove='delete'+type;
  if(!Object.hasOwn(proto,create)||typeof proto[remove]!=='function')continue;
  const originalCreate=proto[create],originalDelete=proto[remove],key=(proto===globalThis.WebGL2RenderingContext?.prototype?'webgl2:':'webgl1:')+type;
  const global=counts[key]={created:0,deleted:0,contextLossReleased:0,live:0};
  proto[create]=function(...args){const value=originalCreate.apply(this,args);if(value){const record=context(this);let row=record.rows.get(key);if(!row){row={global,live:0,closed:false};record.rows.set(key,row)}row.live++;global.created++;global.live++;objects.set(value,{row,active:true})}return value};
  proto[remove]=function(value,...args){const entry=value&&objects.get(value);if(entry?.active){entry.active=false;if(!entry.row.closed){entry.row.live--;entry.row.global.deleted++;entry.row.global.live--}}return originalDelete.call(this,value,...args)};
  restore.push(()=>{proto[create]=originalCreate;proto[remove]=originalDelete});
 }
 globalThis.__benchResources={get counts(){reconcile();return counts},restore:()=>restore.forEach(fn=>fn())};
}
