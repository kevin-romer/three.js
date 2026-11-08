import {createRequire} from 'node:module';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
export async function startJanusServer({app,three,out,variant='r187',css=false,preTransformRequests=true}){
const fixtureConfig={token:null};
const require=createRequire(join(app,'package.json'));
const {createServer}=await import(pathToFileURL(require.resolve('vite')));
const {default:react}=await import(pathToFileURL(require.resolve('@vitejs/plugin-react')));
const {default:tailwind}=await import(pathToFileURL(require.resolve('@tailwindcss/vite')));
const root=variant==='r183'?join(app,'node_modules/three'):three;
const baselineFiles=new Map();
const sourceRef=process.env.BENCH_ENGINE_REF;
if(sourceRef)for(const file of execFileSync('git',['diff','--name-only',sourceRef,'--','src'],{cwd:three,encoding:'utf8'}).trim().split('\n').filter(Boolean))baselineFiles.set(join(three,file),execFileSync('git',['show',sourceRef+':'+file],{cwd:three,encoding:'utf8'}));
const wrapper='\0three-benchmark';
const served=new Map();
const sha=b=>createHash('sha256').update(b).digest('hex');
const plugin={name:'three-engine-benchmark',enforce:'pre',
 resolveId(id){if(id==='three')return wrapper},
 async load(id){if(id!==wrapper)return;return `
 export * from ${JSON.stringify(root+'/src/Three.js')};
 import {WebGLRenderer as Base} from ${JSON.stringify(root+'/src/Three.js')};
 const bench=globalThis.__threeBench={revision:${JSON.stringify(variant)},renderers:[],samples:[],resetSamples:[],active:false,errors:[],scene:null,camera:null};
 export class WebGLRenderer extends Base{
  constructor(...args){super({...args[0],maxInactivePrograms:${variant==='fork-default'?0:16}});bench.renderers.push(this);
   const render=this.render;this.render=(...inputs)=>{const start=performance.now();try{return render.apply(this,inputs)}finally{if(bench.active)bench.samples.push({ms:performance.now()-start,calls:this.info.render.calls,triangles:this.info.render.triangles,geometry:this.info.memory.geometries,textures:this.info.memory.textures,programs:this.info.programs.length});if(bench.observeScene){bench.scene=inputs[0];bench.camera=inputs[1]}}};
   const dispose=this.dispose;this.dispose=(...inputs)=>{try{return dispose.apply(this,inputs)}finally{const i=bench.renderers.indexOf(this);if(i>=0)bench.renderers.splice(i,1)}};
   const reset=this.resetState;this.resetState=(...inputs)=>{const start=performance.now();try{return reset.apply(this,inputs)}finally{if(bench.active)bench.resetSamples.push(performance.now()-start)}};
  }
 }
 `},
 async transform(code,id){const path=id.split('?')[0];if(path.startsWith(app+'/src/')||path.startsWith(app+'/e2e/')){try{served.set(path.slice(app.length+1),sha(await readFile(path)))}catch{}}if(baselineFiles.has(path))code=baselineFiles.get(path);if(path===join(three,'src/math/Matrix4.js')){return code.replace(/toArray\( array = (?:\[\]|undefined), offset = 0 \) \{/,match=>match+`const b=globalThis.__threeBench;if(b?.active){const c=b.matrixCounts??={calls:0,default:0,float32:0,other:0,offsetZero:0,nativeEligible:0};c.calls++;if(arguments[0]===undefined)c.default++;else if(ArrayBuffer.isView(array)&&array instanceof Float32Array)c.float32++;else c.other++;if(offset===0)c.offsetZero++;if(Array.isArray(this.elements)&&this.elements.length===16&&ArrayBuffer.isView(array)&&array instanceof Float32Array&&Number.isInteger(offset)&&offset>=0&&offset+16<=array.length)c.nativeEligible++;}`)}if(baselineFiles.has(path))return code;if(path===join(app,'e2e/fixtures/janus-scenario-studio-workspace.mount.tsx')&&fixtureConfig.token){const anchor=/const AUTH0_ACCESS_TOKEN_FIXTURE\s*=\s*"[^"]*";/;if(!anchor.test(code))throw Error('Controlled fixture token declaration changed');return code.replace(anchor,'const AUTH0_ACCESS_TOKEN_FIXTURE = '+JSON.stringify(fixtureConfig.token)+';');}},
 configureServer(server){server.middlewares.use((req,res,next)=>{if(req.url?.split('?')[0]!=='/__three_bench'){next();return}res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><script type="module">import RefreshRuntime from "/@react-refresh";RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;window.__benchReady=true;</script></body></html>')})}
};
await mkdir(out,{recursive:true});
const server=await createServer({root:app,configFile:false,cacheDir:join(out,'vite-cache-'+variant),plugins:[plugin,react(),...(css?tailwind():[])],worker:{plugins:()=>[plugin]},resolve:{alias:[...[['@','src'],['@app','src/app'],['@components','src/components'],['@features','src/features'],['@hooks','src/hooks'],['@lib','src/lib'],['@pages','src/pages'],['@sdk','src/sdk'],['@config','src/config']].map(([find,dir])=>({find,replacement:join(app,dir)})),{find:/^three\/addons\/(.*)/,replacement:root+'/examples/jsm/$1'},{find:/^three\/examples\/jsm\/(.*)/,replacement:root+'/examples/jsm/$1'},{find:/^three\/src\/(.*)/,replacement:root+'/src/$1'},{find:/^three\/webgpu$/,replacement:root+'/src/Three.WebGPU.js'},{find:/^three\/tsl$/,replacement:root+'/src/Three.TSL.js'}],dedupe:['three']},server:{host:'127.0.0.1',port:0,strictPort:true,preTransformRequests,watch:null,fs:{allow:[app,three,resolve(app,'..')]}},optimizeDeps:{noDiscovery:true,entries:[],include:['react','react-dom/client','react/jsx-runtime','react-router-dom','@tanstack/react-query','@auth0/auth0-react','axios','cookie'],exclude:['three']},logLevel:'warn'});
await server.listen();return {server,fixtureConfig,origin:server.resolvedUrls.local[0].replace(/\/$/,''),served};
}
