import {chromium} from 'playwright';
import {serveHost} from '../../../tools/lib/staticServer.mjs';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
const root=path.resolve('output/windrise');await mkdir(root,{recursive:true});
const server=await serveHost(path.join(root,'web'));
const browser=await chromium.launch({headless:true,args:['--use-angle=d3d11','--enable-webgl','--ignore-gpu-blocklist','--enable-unsafe-swiftshader']});
const errors=[],warnings=[];
try{
 const page=await browser.newPage({viewport:{width:1600,height:900},deviceScaleFactor:1});
 page.on('pageerror',e=>{errors.push(String(e));console.log('ERROR',String(e));});
 page.on('console',m=>{if(m.type()==='error'){if(errors.length<20){errors.push(m.text());console.log('ERROR',m.text().slice(0,500));}}if(m.type()==='warning'&&warnings.length<30)warnings.push(m.text());});
 page.on('response',r=>{if(r.status()>=400)errors.push(`${r.status()} ${r.url()}`);});
 await page.goto(`http://127.0.0.1:${server.address().port}/?headless`,{waitUntil:'load'});
 await page.waitForFunction(()=>window.__estellaCooked?.facts().ready,null,{timeout:60000});
 await page.evaluate(()=>{window.__estellaCooked.setPaused(true);window.__estellaCooked.step(60);});
 await page.screenshot({path:path.join(root,process.argv[2]||'actual.png')});
 const facts=await page.evaluate(()=>window.__estellaCooked.facts());
 await writeFile(path.join(root,'capture.json'),JSON.stringify({errors,warnings,facts},null,2));
 console.log(JSON.stringify({errors,warnings:warnings.slice(0,3),warningCount:warnings.length,facts}));
}finally{await browser.close();server.close();}
