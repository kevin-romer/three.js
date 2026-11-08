// Diagnostic only. Count the WebGLRenderer-owned canvas subscriptions separately
// from application/AbortSignal listeners, without retaining canvases or callbacks.
export function instrumentRendererListeners(){
 const proto=HTMLCanvasElement.prototype,add=proto.addEventListener,remove=proto.removeEventListener,records=new WeakMap(),rows=[],types=new Set(['webglcontextlost','webglcontextrestored','webglcontextcreationerror']);
 const capture=options=>typeof options==='boolean'?options:Boolean(options?.capture);
 proto.addEventListener=function(type,listener,options){
  if(types.has(type)&&listener&&/\/renderers\/WebGLRenderer\.js/.test((new Error().stack??'').split('\n')[2]??'')){
   let record=records.get(this);if(!record){record={listeners:new WeakMap(),row:{canvas:rows.length,added:0,removed:0,live:0,types:{}}};records.set(this,record);rows.push(record.row)}
   let keys=record.listeners.get(listener);if(!keys){keys=new Set();record.listeners.set(listener,keys)}const key=type+':'+capture(options);if(!keys.has(key)){keys.add(key);record.row.added++;record.row.live++;const row=record.row.types[type]??={added:0,removed:0,live:0};row.added++;row.live++}
  }
  return add.call(this,type,listener,options);
 };
 proto.removeEventListener=function(type,listener,options){
  const record=records.get(this),keys=listener&&record?.listeners.get(listener),key=type+':'+capture(options);if(keys?.delete(key)){record.row.removed++;record.row.live--;record.row.types[type].removed++;record.row.types[type].live--}
  return remove.call(this,type,listener,options);
 };
 globalThis.__rendererListenerAudit={snapshot:()=>structuredClone(rows),restore:()=>{delete proto.addEventListener;delete proto.removeEventListener}};
}
