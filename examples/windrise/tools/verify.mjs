import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {serveHost} from '../../../tools/lib/staticServer.mjs';

const root=path.resolve('output/windrise');
await mkdir(root,{recursive:true});
const server=await serveHost(path.join(root,'web'));
const browser=await chromium.launch({headless:true,args:['--use-angle=d3d11','--enable-webgl','--ignore-gpu-blocklist','--enable-unsafe-swiftshader']});
const errors=[],warnings=[],checks=[];
try{
 const page=await browser.newPage({viewport:{width:1600,height:900},deviceScaleFactor:1});
 page.on('pageerror',e=>errors.push(String(e)));
 page.on('console',m=>{if(m.type()==='error'&&errors.length<20)errors.push(m.text());if(m.type()==='warning'&&warnings.length<20)warnings.push(m.text());});
 page.on('response',r=>{if(r.status()>=400)errors.push(`${r.status()} ${r.url()}`);});
 await page.goto(`http://127.0.0.1:${server.address().port}/?headless`,{waitUntil:'load'});
 await page.waitForFunction(()=>window.__estellaCooked?.facts().ready,null,{timeout:60000});
 const facts=()=>page.evaluate(()=>window.__estellaCooked.facts());
 const pause=v=>page.evaluate(v=>window.__estellaCooked.setPaused(v),v);
 const step=n=>page.evaluate(n=>window.__estellaCooked.step(n),n);
 const observe=async()=>{const f=(await facts()).frame;await page.waitForFunction(f=>window.__estellaCooked.facts().frame>=f+2,f);};
 const keys=async(codes,n=1,during=null)=>{await pause(false);for(const c of codes)await page.keyboard.down(c);await observe();await pause(true);if(n>1)await step(n);if(during)await during();for(const c of codes)await page.keyboard.up(c);await step(2);};
 const shot=name=>page.screenshot({path:path.join(root,name+'.png')});
 await pause(true);await step(60);
 const initial=await facts();assert.equal(initial.animation,'Locomotion');
 await step(25);const idle=await facts();assert.notEqual(idle.handX,initial.handX,'The imported skeleton must actually animate');
 checks.push('Native scene, textures, controller, five timeline clips and animated skeleton load');
 await shot('actual');
 await keys(['w'],90);const walk=await facts();assert.ok(walk.travel>3);assert.ok(walk.z<initial.z-3);
 await keys(['Shift','w'],90,()=>shot('running'));const run=await facts();assert.ok(run.travel-walk.travel>walk.travel*1.5);assert.ok(run.stamina<80);
 checks.push('Walking and sprinting move the traveler; sprinting consumes stamina');
 await keys(['Space'],6);const jump=await facts();assert.equal(jump.grounded,false);assert.equal(jump.animation,'Airborne');await shot('jump');
 await step(100);assert.equal((await facts()).grounded,true);assert.equal((await facts()).animation,'Locomotion');
 checks.push('Jump uses the Airborne animation and lands back on the terrain');
 await keys(['e'],5);assert.ok((await facts()).skill>0);assert.equal((await facts()).animation,'Anemo');await shot('anemo');
 await step(200);assert.equal((await facts()).animation,'Locomotion');assert.equal((await facts()).skill,0);
 checks.push('Wind skill plays, expires and returns to locomotion');
 await keys(['Home']);await keys(['v']);assert.equal((await facts()).front,true);await step(12);await shot('lumine-front');
 await keys(['p']);assert.equal((await facts()).photo,true);
 await pause(false);await page.mouse.wheel(0,-460);await observe();await pause(true);await step(4);await shot('lumine-photo');
 await keys(['p']);assert.equal((await facts()).photo,false);
 checks.push('Front camera and photography toggle through real browser keyboard events');
 await keys(['Home']);
 // Walk to the shrine with ordinary keys; no test teleport or alternate terrain.
 await keys(['w'],1010);let near=await facts();
 for(let n=0;n<5&&Math.abs(near.x+7)>1;n++){await keys([near.x>-7?'a':'d'],Math.max(1,Math.round(Math.abs(near.x+7)/2.65*60)));near=await facts();}
 assert.ok(Math.hypot(near.x+7,near.z+19)<4,JSON.stringify(near));
 await keys(['f']);assert.equal((await facts()).activated,true);
 await pause(false);await page.mouse.wheel(0,450);await observe();await pause(true);await step(3);await shot('shrine');
 checks.push('Shrine can be reached on foot and its interaction updates the quest');
 await keys(['Home']);const reset=await facts();assert.ok(Math.abs(reset.x)<.001&&Math.abs(reset.z-28)<.001);
 await page.setViewportSize({width:1280,height:720});await step(3);await shot('1280x720');
 checks.push('Reset and 1280×720 HUD layout');
 assert.deepEqual(errors,[]);assert.deepEqual(warnings,[]);
 const report={status:'passed',checks,errors,warnings,facts:await facts(),renderer:'Headless Chromium / WebGL2',visualAcceptance:'Visual study; no pixel-identical or original-game-quality claim.'};
 await writeFile(path.join(root,'verification.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
}catch(error){await writeFile(path.join(root,'verification-failure.json'),JSON.stringify({error:String(error),checks,errors,warnings},null,2));throw error;}
finally{await browser.close();server.close();}
