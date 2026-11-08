import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
const [out]=process.argv.slice(2),variants=[];
for(const variant of ['r187','fork']){
 const bytes=await readFile(join(out,'desktop-diagnostic-'+variant+'.cpuprofile')),profile=JSON.parse(bytes),nodes=new Map(profile.nodes.map(n=>[n.id,n])),parents=new Map();
 for(const n of profile.nodes)for(const child of n.children??[])parents.set(child,n.id);
 const underThree=new Map();function hasThreeAncestor(id){if(underThree.has(id))return underThree.get(id);const node=nodes.get(id);const result=Boolean(node&&(/\/three\.js\/src\//.test(node.callFrame.url)||parents.has(id)&&hasThreeAncestor(parents.get(id))));underThree.set(id,result);return result}
 const categories={programInfoLog:0,shaderInfoLog:0,otherUnderThree:0,garbageCollection:0,otherOrUnattributed:0};let total=0;
 for(let i=0;i<profile.samples.length;i++){const id=profile.samples[i],node=nodes.get(id),duration=profile.timeDeltas?.[i]??0;total+=duration;let category='otherOrUnattributed';if(node.callFrame.functionName==='(garbage collector)')category='garbageCollection';else if(hasThreeAncestor(id)){category=node.callFrame.functionName==='getProgramInfoLog'?'programInfoLog':node.callFrame.functionName==='getShaderInfoLog'?'shaderInfoLog':'otherUnderThree'}categories[category]+=duration}
 variants.push({variant,rawProfileSha256:createHash('sha256').update(bytes).digest('hex'),sampledDurationMs:total/1000,categoriesMs:Object.fromEntries(Object.entries(categories).map(([k,v])=>[k,v/1000]))});
}
const result={scope:'Separate sampled diagnostic, including 120 warmup frames, correctness readbacks and 30 counted frames; not formal paired timing. Attribution follows Three.js source ancestors and can include native waits or callbacks under those frames. Other/unattributed is not a claim of application-only cost. Raw profiles remain private.',variants};await writeFile(join(out,'profile-summary.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
