import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
export async function loadFixtures(app,out,{fixtureToken}={}){
 const require=createRequire(join(app,'package.json')),ts=require('typescript');
 const source=await readFile(join(app,'e2e/janus-scenario-studio-workspace.spec.ts'),'utf8');
 const boundary=source.indexOf('test("Scenario workspace keeps');if(boundary<0)throw Error('Fixture adapter boundary changed');
 let code=source.slice(0,boundary).replace('import { expect, test, type Page } from \"@playwright/test\";', 'import __playwright from \"@playwright/test\"; const {expect,test}=__playwright;');
 if(fixtureToken)code=code.replace(/const AUTH0_ACCESS_TOKEN_FIXTURE\s*=\s*"[^"]*";/,'const AUTH0_ACCESS_TOKEN_FIXTURE = '+JSON.stringify(fixtureToken)+';');
 const ast=ts.createSourceFile('fixtures.ts',code,ts.ScriptTarget.Latest,true);
 const functions=ast.statements.filter(ts.isFunctionDeclaration).filter(node=>node.name).map(node=>node.name.text);
 const spatial=ast.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='fulfillProtectedSpatialPresentation');
 const edits=[];function visit(node){if(ts.isStringLiteral(node)&&node.text==='2035')edits.push({start:node.getStart(ast),end:node.end,text:JSON.stringify('year:2026')});ts.forEachChild(node,visit)}
 if(spatial)visit(spatial);for(const edit of edits.sort((a,b)=>b.start-a.start))code=code.slice(0,edit.start)+edit.text+code.slice(edit.end);

 for(const pkg of ['@playwright/test','@axe-core/playwright'])code=code.replace(JSON.stringify(pkg),JSON.stringify(pathToFileURL(require.resolve(pkg)).href));
 code+='\nexport {'+functions.join(',')+'};';
 const result=ts.transpileModule(code,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2023,verbatimModuleSyntax:false}});
 const file=join(out,'private-product-fixtures.mjs');await writeFile(file,result.outputText);return import(pathToFileURL(file).href+'?configured='+createHash('sha256').update(fixtureToken??'original').digest('hex'));
}
