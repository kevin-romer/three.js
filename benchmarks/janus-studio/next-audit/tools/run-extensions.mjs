import {spawn} from 'node:child_process';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
const [app,three,out]=process.argv.slice(2),root=dirname(fileURLToPath(import.meta.url));
for(const stage of ['e02-frozen','c09'])await new Promise((resolve,reject)=>{const child=spawn(process.execPath,[join(root,'extend-studio.mjs'),app,three,out,stage],{stdio:'inherit'});child.on('error',reject);child.on('exit',c=>c===0?resolve():reject(Error(stage+' extension failed '+c)))});
