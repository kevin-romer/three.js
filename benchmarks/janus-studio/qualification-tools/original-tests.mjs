// Adapt existing local product tests without copying their source into the fork.
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
export async function loadOriginalTest(app,out,file,name,token){
 const require=createRequire(join(app,'package.json')),ts=require('typescript'),source=await readFile(join(app,file),'utf8'),ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true);
 const calls=ast.statements.filter(ts.isExpressionStatement).map(s=>s.expression).filter(ts.isCallExpression).filter(c=>c.expression.getText(ast)==='test');
 const test=calls.find(c=>c.arguments[0]?.text===name);if(!test)throw Error('Original product test changed: '+name);
 let code=source.slice(0,calls[0].parent.getStart(ast))+'\nexport const runOriginalTest = '+test.arguments[1].getText(ast)+';';
 code=code.replace('import { expect, test, type Page } from "@playwright/test";','import __playwright from "@playwright/test"; const {expect}=__playwright; const test={setTimeout:ms=>globalThis.__originalTestDeadline(ms)};').replace('import { expect, test } from "@playwright/test";','import __playwright from "@playwright/test"; const {expect}=__playwright; const test={setTimeout:ms=>globalThis.__originalTestDeadline(ms)};');
 if(token)code=code.replace(/const AUTH0_ACCESS_TOKEN_FIXTURE\s*=\s*"[^"]*";/,'const AUTH0_ACCESS_TOKEN_FIXTURE = '+JSON.stringify(token)+';');
 for(const pkg of ['@playwright/test','@axe-core/playwright'])code=code.replace(JSON.stringify(pkg),JSON.stringify(pathToFileURL(require.resolve(pkg)).href));
 const result=ts.transpileModule(code,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2023,verbatimModuleSyntax:false}}),hash=createHash('sha256').update(source).digest('hex');
 const path=join(out,'private-original-test-'+createHash('sha256').update(file+name).digest('hex').slice(0,12)+'.mjs');await writeFile(path,result.outputText);
 return{...(await import(pathToFileURL(path).href+'?token='+createHash('sha256').update(token??'').digest('hex'))),sourceSha256:hash};
}
