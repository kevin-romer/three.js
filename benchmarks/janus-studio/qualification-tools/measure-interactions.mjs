// Diagnostic latency only. Pixel verification/readback is separate from the
// render-event timestamp; this does not measure GPU or display completion.
export async function measureStudioInteractions({hashes,cycles=10}){
 const runtime=__benchRuntimes.find(r=>r.mounted),map=__benchMaps.find(m=>{try{return m.getNativeFrame()}catch{return false}}),gl=map.getCanvas().getContext('webgl2');
 const rows=[];
 const digest=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');
 async function mutate(name,operation,expectedHash,cycle){
  const start=performance.now();operation();const actionMs=performance.now()-start;
  for(let attempt=0;attempt<10;attempt++){
   const sample=await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>{map.off('render',on);reject(Error('Interaction frame timeout: '+name))},10000);function on(){if(!map.getNativeFrame())return;map.off('render',on);clearTimeout(timeout);const renderEventAt=performance.now(),bytes=new Uint8Array(gl.drawingBufferWidth*gl.drawingBufferHeight*4),readStart=performance.now();gl.readPixels(0,0,gl.drawingBufferWidth,gl.drawingBufferHeight,gl.RGBA,gl.UNSIGNED_BYTE,bytes);resolve({renderEventAt,readbackMs:performance.now()-readStart,bytes})}map.on('render',on);map.triggerRepaint()});
   const hashStart=performance.now(),hash=await digest(sample.bytes),hashMs=performance.now()-hashStart;
   if(hash===expectedHash){rows.push({cycle,name,actionMs,renderEventMs:sample.renderEventAt-start,readbackMs:sample.readbackMs,hashMs,framesUntilExpected:attempt+1,sha256:hash});return}
  }
  throw Error('Interaction did not reach expected pixels: '+name);
 }
 const source=map.getSource('benchmark-parcels'),original=__benchDataset,edited=structuredClone(original);for(const coordinate of edited.features[210].geometry.coordinates[0])coordinate[0]+=.0001;
 for(let i=0;i<cycles;i++){
  await mutate('select',()=>runtime.select(['parcel:p210']),hashes.selected,i);
  await mutate('clear-selection',()=>runtime.select([]),hashes.baseline,i);
  await mutate('style-edit',()=>map.setPaintProperty('benchmark-parcels-fill','fill-opacity',.35),hashes.styleEdited,i);
  await mutate('style-reset',()=>map.setPaintProperty('benchmark-parcels-fill','fill-opacity',.7),hashes.baseline,i);
  await mutate('geometry-edit',()=>source.setData(edited),hashes.geometryEdited,i);
  await mutate('geometry-reset',()=>source.setData(original),hashes.baseline,i);
 }
 if(gl.getError())throw Error('GL error during interaction sampling');
 const percentile=(values,p)=>[...values].sort((a,b)=>a-b)[Math.ceil(values.length*p)-1];
 const summary={};for(const name of [...new Set(rows.map(r=>r.name))]){const samples=rows.filter(r=>r.name===name);summary[name]={samples:samples.length};for(const metric of ['actionMs','renderEventMs','readbackMs','hashMs'])summary[name][metric]={p50:percentile(samples.map(r=>r[metric]),.5),p95:percentile(samples.map(r=>r[metric]),.95),max:Math.max(...samples.map(r=>r[metric]))}}
 return{scope:'10 repeated cycles in one diagnostic run; no confidence interval or speedup claim. Render-event latency excludes current readback and hashing, but prior verification can affect scheduling. Not GPU/display completion.',rows,summary};
}
