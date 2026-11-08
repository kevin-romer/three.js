import {readFile,writeFile,copyFile,mkdir,stat} from 'node:fs/promises';
import {resolve,join,dirname,relative} from 'node:path';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
const [app,out]=process.argv.slice(2),target=join(out,'private-app'),manifestPath=join(out,'private-app-source-manifest.json'),manifest=JSON.parse(await readFile(manifestPath)),require=createRequire(join(app,'package.json')),ts=require('typescript'),added=[];
const aliases={'@':'src','@app':'src/app','@components':'src/components','@features':'src/features','@hooks':'src/hooks','@lib':'src/lib','@pages':'src/pages','@sdk':'src/sdk','@config':'src/config'};
for(const file of Object.keys(manifest.sourceFiles)){
 if(!/\.[cm]?[jt]sx?$/.test(file))continue;
 const ast=ts.createSourceFile(file,await readFile(join(target,file),'utf8'),ts.ScriptTarget.Latest,true),specifiers=new Set();
 function visit(node){if((ts.isImportDeclaration(node)&&!node.importClause?.isTypeOnly||ts.isExportDeclaration(node)&&!node.isTypeOnly)&&node.moduleSpecifier&&ts.isStringLiteral(node.moduleSpecifier))specifiers.add(node.moduleSpecifier.text);if((ts.isCallExpression(node)&&(node.expression.kind===ts.SyntaxKind.ImportKeyword||node.expression.getText(ast)==='require')||ts.isNewExpression(node)&&node.expression.getText(ast)==='URL')&&node.arguments?.[0]&&ts.isStringLiteral(node.arguments[0]))specifiers.add(node.arguments[0].text);ts.forEachChild(node,visit)}visit(ast);
 for(const spec of specifiers){let base;if(spec.startsWith('.'))base=resolve(app,dirname(file),spec);else{const first=spec.split('/')[0];if(aliases[first])base=resolve(app,aliases[first],spec.slice(first.length+1))}if(!base)continue;
  for(const candidate of [base,...['.ts','.tsx','.js','.jsx','.mjs','.json','.css'].map(e=>base+e),...['index.ts','index.tsx','index.js'].map(e=>join(base,e))]){let st;try{st=await stat(candidate)}catch{continue}if(!st.isFile())continue;const name=relative(app,candidate);if(name.startsWith('..'))throw Error('Resolution escaped app');if(!manifest.sourceFiles[name]){const dest=join(target,name);await mkdir(dirname(dest),{recursive:true});const bytes=await readFile(candidate);await writeFile(dest,bytes);manifest.sourceFiles[name]=createHash('sha256').update(bytes).digest('hex');added.push({name,bytes:bytes.length})}break;}
 }
}
manifest.sourceFiles=Object.fromEntries(Object.entries(manifest.sourceFiles).sort(([a],[b])=>a.localeCompare(b)));
await writeFile(manifestPath,JSON.stringify(manifest,null,2));console.log(JSON.stringify({resolutionTargetsAdded:added.length,bytes:added.reduce((n,r)=>n+r.bytes,0),sourceFiles:Object.keys(manifest.sourceFiles).length}));
