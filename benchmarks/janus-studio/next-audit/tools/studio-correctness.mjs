// Executed inside the browser against the real mounted Studio runtime.
export async function studioCorrectness(){
 const runtime=globalThis.__benchRuntimes.find(r=>r.mounted),map=globalThis.__benchMaps.find(m=>{try{return m.getNativeFrame()}catch{return false}});
 if(!runtime||!map)throw Error('Mounted Studio required');
 const gl=map.getCanvas().getContext('webgl2');
 const frame=()=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>{map.off('render',on);reject(Error('Current frame timeout'))},10000);function on(){if(!map.getNativeFrame())return;map.off('render',on);clearTimeout(timer);const bytes=new Uint8Array(gl.drawingBufferWidth*gl.drawingBufferHeight*4);gl.readPixels(0,0,gl.drawingBufferWidth,gl.drawingBufferHeight,gl.RGBA,gl.UNSIGNED_BYTE,bytes);resolve(bytes)}map.on('render',on);map.triggerRepaint()});
 const hash=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');
 const digest=async()=>{let prior=null;for(let i=0;i<8;i++){const current=await hash(await frame());if(current===prior)return current;prior=current}throw Error('Framebuffer did not settle')};
 runtime.setCamera({longitude:-77.05,latitude:38.8,zoom:17,bearing:-18,pitch:0});
 const baseline=await digest(),ids=runtime.visibleParcelRefs();
 if(!ids.includes('parcel:p210'))throw Error('Expected visible stable parcel identity');
 const point=map.project([-77.0499725,38.80002]);
 const picks=[];for(let i=0;i<100;i++){const start=performance.now(),hits=runtime.hitTest(point);picks.push({ms:performance.now()-start,ids:hits.map(h=>h.entityRef)});if(!hits.some(h=>h.entityRef==='parcel:p210'))throw Error('Pick identity lost')}
 runtime.select(['parcel:p210']);const selected=await digest();
 if(JSON.stringify(runtime.selectedEntityRefs)!=='["parcel:p210"]'||selected===baseline)throw Error('Selection state/visible update failed');
 runtime.select([]);const cleared=await digest();if(cleared!==baseline)throw Error('Cleared selection changed base output '+JSON.stringify({baseline,selected,cleared,camera:map.getNativeFrame()?.camera,width:gl.drawingBufferWidth,height:gl.drawingBufferHeight,selection:runtime.selectedEntityRefs}));
 map.setPaintProperty('benchmark-parcels-fill','fill-opacity',.35);const styleEdited=await digest();if(styleEdited===baseline)throw Error('Style edit not visible');
 map.setPaintProperty('benchmark-parcels-fill','fill-opacity',.7);if(await digest()!==baseline)throw Error('Style reset changed base output');
 const source=map.getSource('benchmark-parcels'),data=structuredClone(globalThis.__benchDataset);
 if(!data)throw Error('Fixture dataset required');
 const polygon=data.features[210].geometry.coordinates[0];for(const coordinate of polygon)coordinate[0]+=.0001;
 source.setData(data);const geometryEdited=await digest();if(geometryEdited===baseline)throw Error('Geometry edit not visible');
 source.setData(globalThis.__benchDataset);if(await digest()!==baseline)throw Error('Geometry reset changed base output');
 const comparison=[];
 for(let cycle=0;cycle<5;cycle++){
  const host=document.createElement('div');host.style.cssText='position:fixed;right:0;bottom:0;width:600px;height:400px;z-index:10000';document.body.append(host);
  runtime.enableComparison(host);
  let other;const deadline=performance.now()+20000;
  while(performance.now()<deadline){other=__benchMaps.find(m=>{try{return m!==map&&m.getNativeFrame()&&m.queryRenderedFeatures({layers:['benchmark-parcels-fill']}).length>0}catch{return false}});if(other)break;await new Promise(r=>setTimeout(r,25))}
  if(!other)throw Error('Comparison did not render useful geometry');
  const cgl=other.getCanvas().getContext('webgl2'),pixels=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Comparison frame timeout')),10000);const on=()=>{if(!other.getNativeFrame())return;clearTimeout(timer);other.off('render',on);const bytes=new Uint8Array(cgl.drawingBufferWidth*cgl.drawingBufferHeight*4);cgl.readPixels(0,0,cgl.drawingBufferWidth,cgl.drawingBufferHeight,cgl.RGBA,cgl.UNSIGNED_BYTE,bytes);resolve(bytes)};other.on('render',on);other.triggerRepaint()});
  if(!pixels.some(Boolean)||cgl.getError())throw Error('Invalid comparison framebuffer');
  const before=__threeBench.renderers.length;runtime.disableComparison();host.remove();host.replaceChildren();
  globalThis.__benchMaps=__benchMaps.filter(m=>m!==other);
  const removedListeners=[...other.listeners.values()].reduce((n,s)=>n+s.size,0),removedDelegated=other.delegated.size;other=null;
  if(removedListeners||removedDelegated)throw Error('Comparison listeners retained');
  // Remove observation-only references to destroyed maps so they cannot bias heap checks.
  globalThis.__benchMaps=__benchMaps.filter(m=>{try{m.getNativeLifetime();return true}catch{return false}});
  if(__threeBench.renderers.length!==before-1)throw Error('Comparison renderer retained after teardown');
  // Context-loss delivery and its native event queue must retire before retained-heap sampling.
  await new Promise(resolve=>setTimeout(resolve,1100));
  const heap=globalThis.__benchCollectGarbage?await __benchCollectGarbage():null;
  comparison.push({cycle,heap,resources:globalThis.__benchResources?structuredClone(__benchResources.counts):null,removedListeners,removedDelegated,hash:await hash(pixels),rendererListeners:globalThis.__rendererListenerAudit?.snapshot()??null,observerMaps:__benchMaps.map(m=>({disposed:m.disposed,aborted:m.rootLifetime.signal.aborted})),liveRenderers:__threeBench.renderers.length,programs:__threeBench.renderers.map(r=>r.info.programs.length)});
 }
 if(await digest()!==baseline)throw Error('Comparison teardown changed primary');
 if(gl.getError())throw Error('GL error during correctness checks');
 return{visibleEntityIds:ids,picks,hashes:{baseline,selected,cleared,styleEdited,geometryEdited},comparison};
}
