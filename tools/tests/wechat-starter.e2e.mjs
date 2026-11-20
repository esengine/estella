// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import fs from 'node:fs';import path from 'node:path';import http from 'node:http';import crypto from 'node:crypto';import assert from 'node:assert/strict';import {chromium} from 'playwright';import {HOST_PAGE} from '../launchers/minigameHost.mjs';
import { toolArgs } from '../lib/toolArgs.mjs';
import { MIME as mime } from '../lib/staticServer.mjs';
const ARGS=toolArgs({dir:null,out:null});if(!ARGS.dir)throw Error('Expected --dir');
const root=fs.realpathSync(ARGS.dir),out=path.resolve(ARGS.out??'output/wechat-starter-check');fs.mkdirSync(out,{recursive:true});
const sha=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const files=(under='')=>fs.readdirSync(path.join(root,under),{withFileTypes:true}).flatMap(e=>{const name=under?`${under}/${e.name}`:e.name;return e.isDirectory()?files(name):[name];});
const report={status:'failed',headless:true,mode:'local-contract-host',identities:Object.fromEntries(files().map(file=>[file,sha(path.join(root,file))])),verifierSha256:sha(new URL(import.meta.url)),errors:[],unexpectedRequests:[]};
let html=HOST_PAGE('game.js');const marker="  try {\n    log('booting";
if(!html.includes(marker))throw Error('Contract host hook changed');
html=html.replace(marker,`  globalThis.__calls={login:0,share:0,reward:0};
  wx.login=o=>{__calls.login++;queueMicrotask(()=>o.success({code:'local-mock-code'}))};
  wx.shareAppMessage=()=>{__calls.share++};
  wx.createRewardedVideoAd=()=>{const close=new Set();return{load:()=>Promise.resolve(),show:()=>{
    __calls.reward++;if(globalThis.__failReward>0){globalThis.__failReward--;return Promise.reject(new Error('no fill'))}
    globalThis.__finishReward=ended=>{for(const cb of [...close])cb({isEnded:ended})};return Promise.resolve()},
    onClose:cb=>close.add(cb),offClose:cb=>close.delete(cb),destroy:()=>close.clear()}};
`+marker);
report.hostSha256=crypto.createHash('sha256').update(html).digest('hex');
const server=http.createServer((req,res)=>{try{const name=decodeURIComponent(new URL(req.url,'http://localhost').pathname).slice(1);if(!name){res.setHeader('Content-Type','text/html');res.end(html);return;}
 const file=fs.realpathSync(path.resolve(root,name));if(!file.startsWith(root+path.sep)||!fs.statSync(file).isFile())throw Error('Outside export');
 res.setHeader('Content-Type',mime[path.extname(file)]??'application/octet-stream');if(file.endsWith('.br'))res.setHeader('Content-Encoding','br');res.end(fs.readFileSync(file));}catch{res.writeHead(404);res.end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true,args:['--enable-unsafe-swiftshader','--use-angle=swiftshader','--mute-audio']});
try {
 const context=await browser.newContext({viewport:{width:360,height:640},hasTouch:true}),page=await context.newPage();
 const consoleLines=[];page.on('console',message=>consoleLines.push(message.type()+': '+message.text().slice(0,300)));page.on('pageerror',error=>report.errors.push(String(error)));page.on('console',message=>{if(message.type()==='error')report.errors.push(message.text());});
 await context.route('**/*',route=>{if(route.request().url().startsWith(origin+'/'))return route.continue();report.unexpectedRequests.push(route.request().url());return route.abort();});
 await page.goto(origin+'/');// Polled on a clock, not on the page's animation frames: the condition is three globals, and a page busy loading can starve the frames a wait rides on. A miss says which one never came true, and what the page said.
 await page.waitForFunction(()=>globalThis.__wxStarterProbe&&globalThis.__estellaLoading===null&&globalThis.__estellaIdentDone===true,{},{timeout:30000,polling:100}).catch(async error=>{const state=await page.evaluate(()=>({probe:typeof globalThis.__wxStarterProbe,loading:globalThis.__estellaLoading===undefined?'undefined':JSON.stringify(globalThis.__estellaLoading),identDone:globalThis.__estellaIdentDone})).catch(e=>String(e));throw Error(`starter never became ready: ${JSON.stringify(state)}; errors ${JSON.stringify(report.errors)}; console ${JSON.stringify(consoleLines.slice(-20))}`,{cause:error});});
 report.sceneInitializedMs=await page.evaluate(()=>performance.now());
 report.timingScope='Local contract-host scene initialization after the loading indicator clears. Not real-device cold startup or official time-to-interactive certification.';
 const state=()=>page.evaluate(()=>__wxStarterProbe());const tap=async(x,y)=>{await page.touchscreen.tap(360*x,640*y);};
 for(const x of [.2,.5,.8])await tap(x,.45);await page.waitForFunction(()=>__wxStarterProbe().selected===3);
 await tap(.5,.96);await page.waitForFunction(()=>__wxStarterProbe().selected===0);
 await tap(.19,.81);await page.waitForFunction(()=>__wxStarterProbe().message.includes('connect your server'));assert.equal(await page.evaluate(()=>__calls.login),1);
 await tap(.5,.81);await page.waitForFunction(()=>__wxStarterProbe().message.includes('cannot be confirmed'));assert.equal((await state()).credits,0);
 const watch=async ended=>{await tap(.81,.81);await page.waitForFunction(()=>__wxStarterProbe().busy&&typeof __finishReward==='function');await page.evaluate(value=>__finishReward(value),ended);await page.waitForFunction(()=>!__wxStarterProbe().busy);};
 await watch(false);assert.equal((await state()).credits,0);await watch(true);assert.equal((await state()).credits,1);
 await page.evaluate(()=>{globalThis.__failReward=2});await tap(.81,.81);await page.waitForFunction(()=>__wxStarterProbe().message.includes('video failed'));assert.equal((await state()).credits,1);
 await page.reload();await page.waitForFunction(()=>globalThis.__wxStarterProbe&&globalThis.__estellaLoading===null&&globalThis.__estellaIdentDone===true);assert.equal((await state()).credits,1);
 report.restored=await state();const file='restored.png';await page.screenshot({path:path.join(out,file)});report.screenshot={file,sha256:sha(path.join(out,file))};
 assert.deepEqual(report.errors,[]);assert.deepEqual(report.unexpectedRequests,[]);report.status='checks-passed';await context.close();
}finally{fs.writeFileSync(path.join(out,'runtime-check.json'),JSON.stringify(report,null,2));await browser.close();await new Promise(resolve=>server.close(resolve));}
console.log('WeChat starter: real touch gameplay/login/share/reward cancel/complete/failure/reload passed in headless contract host');
