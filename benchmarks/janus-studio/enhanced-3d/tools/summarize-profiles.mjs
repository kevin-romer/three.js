import {readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const out=resolve(process.argv[2]),variants=[];
for(const variant of ['control','candidate']){
 const bytes=await readFile(join(out,`layout-profile-${variant}.cpuprofile`)),profile=JSON.parse(bytes),nodes=new Map(profile.nodes.map(n=>[n.id,n])),parents=new Map();
 for(const n of profile.nodes)for(const child of n.children??[])parents.set(child,n.id);
 const isPreparation=n=>n&&/\/src\/renderers\/webgl\/WebGLPrograms\.js/.test(n.callFrame.url)&&['getParameters','WebGLProgramParameters'].includes(n.callFrame.functionName);
 const isRender=n=>n&&/\/src\/renderers\/WebGLRenderer\.js/.test(n.callFrame.url)&&n.callFrame.functionName==='WebGLRenderer.render';
 const under=(id,fn)=>{for(let node=nodes.get(id);node;node=nodes.get(parents.get(node.id)))if(fn(node))return true;return false};
 let total=0,self=0,inclusive=0,render=0,gc=0;
 for(let i=0;i<profile.samples.length;i++){const id=profile.samples[i],node=nodes.get(id),duration=profile.timeDeltas[i];total+=duration;if(isPreparation(node))self+=duration;if(under(id,isPreparation))inclusive+=duration;if(under(id,isRender))render+=duration;if(node.callFrame.functionName==='(garbage collector)')gc+=duration;}
 const record=JSON.parse(await readFile(join(out,`layout-profile-${variant}.json`)));assert.deepEqual(record.errors,[]);assert.deepEqual(record.logs,[]);assert.equal(record.result.glError,0);
 variants.push({variant,rawProfileSha256:createHash('sha256').update(bytes).digest('hex'),sampledDurationMs:total/1000,parameterPreparationSelfMs:self/1000,parameterPreparationInclusiveMs:inclusive/1000,underRendererInclusiveMs:render/1000,wholeProfileGcMs:gc/1000,frames:record.result.frames,warmup:record.result.warmup});
}
const records=await Promise.all(['control','candidate'].map(async v=>JSON.parse(await readFile(join(out,`layout-profile-${v}.json`)))));
assert.deepEqual(records[0].result.pixels,records[1].result.pixels);assert.deepEqual(records[0].result.summaries.map(s=>[s.draws,s.triangles,s.renderCalls]),records[1].result.summaries.map(s=>[s.draws,s.triangles,s.renderCalls]));
const result={scope:'Separate 100us Chrome CPU sampling diagnostics, each covering 120 warmup frames, three framebuffer captures and 300 measured frames. Inclusive renderer attribution can contain application callbacks and native waits. One profile per variant; not formal performance estimates. Raw profiles remain private.',variants};
await writeFile(join(out,'profile-summary.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
