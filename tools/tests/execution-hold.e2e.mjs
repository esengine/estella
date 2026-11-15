// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import fs from 'node:fs';import path from 'node:path';import http from 'node:http';import crypto from 'node:crypto';
import assert from 'node:assert/strict';import {chromium} from 'playwright';
import { toolArgs } from '../lib/toolArgs.mjs';
const ARGS=toolArgs({dir:null,out:null});
if(!ARGS.dir)throw Error('Expected --dir <fixture export>');
const root=fs.realpathSync(ARGS.dir),out=path.resolve(ARGS.out??'output/execution-hold-check');fs.mkdirSync(out,{recursive:true});
const sha=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const files=(under='')=>fs.readdirSync(path.join(root,under),{withFileTypes:true}).flatMap(entry=>{
    const file=under?`${under}/${entry.name}`:entry.name;if(entry.isDirectory())return files(file);
    if(!entry.isFile())throw Error('Unsupported export entry');return[file];
});
const identities=Object.fromEntries(files().map(file=>[file,sha(path.join(root,file))]));
const report={headless:true,mode:'authored-fixture',status:'failed',identities,verifierSha256:sha(new URL(import.meta.url)),errors:[],unexpectedRequests:[],observations:[]};
const mime={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.json':'application/json','.wasm':'application/wasm','.png':'image/png'};
const server=http.createServer((req,res)=>{try{const name=decodeURIComponent(new URL(req.url,'http://localhost').pathname).slice(1)||'index.html';
    const file=fs.realpathSync(path.resolve(root,name));if(!file.startsWith(root+path.sep)||!fs.statSync(file).isFile())throw Error('Outside export');
    res.setHeader('Content-Type',mime[path.extname(file)]??'application/octet-stream');res.end(fs.readFileSync(file));}catch{res.writeHead(404);res.end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true,args:['--enable-unsafe-swiftshader','--use-angle=swiftshader','--mute-audio']});
let page;
try {
    page=await browser.newPage({viewport:{width:800,height:450}});page.on('pageerror',error=>report.errors.push(String(error)));
    report.console=[];page.on('console',message=>{if(message.type()==='error'||message.type()==='warning')report.console.push(message.text().slice(0,1000));});
    await page.addInitScript(()=>{window.__audioContexts=[];const Original=window.AudioContext;
        if(Original)window.AudioContext=class extends Original{constructor(...args){super(...args);window.__audioContexts.push(this);}};});
    await page.route('**/*',route=>{const url=route.request().url();if(url.startsWith(origin+'/')||url.startsWith('data:'))return route.continue();report.unexpectedRequests.push(url);return route.abort();});
    await page.goto(origin+'/?headless');await page.waitForFunction(()=>window.__executionFixture?.probe&&window.__estellaCooked?.probe(['ExecutionProbe']).at.ExecutionProbe);
    await page.waitForFunction(()=>!document.getElementById('es-splash'));
    const box=await page.evaluate(()=>__estellaCooked.probe(['ExecutionProbe']).at.ExecutionProbe),point={x:400+box.x,y:225-box.y};
    await page.mouse.click(point.x,point.y);await page.waitForFunction(()=>__executionFixture.clicks===1&&__executionFixture.video?.isReady&&__executionFixture.video?.isPlaying);
    await page.waitForFunction(()=>__audioContexts.length>0&&__audioContexts.every(context=>context.state==='running'));
    const facts=()=>page.evaluate(async()=>{const{Time}=await import('esengine');const state=__executionFixture;return{frame:state.app.getResource(Time).frameCount,clicks:state.clicks,
        playing:state.video.isPlaying,mediaTime:state.video.currentTime,player:__estellaCooked.probe(['Player']).at.Player};});
    await page.mouse.move(point.x,point.y);await page.mouse.down();await page.waitForTimeout(100);
    await page.evaluate(()=>{window.__releaseA=__executionFixture.app.holdExecution();window.__releaseB=__executionFixture.app.holdExecution();});
    await page.waitForFunction(()=>__audioContexts.every(context=>context.state==='suspended'));
    const held=await facts();assert.equal(held.playing,false);report.observations.push({stage:'held',...held});
    await page.mouse.up();await page.mouse.click(point.x,point.y);await page.keyboard.press('KeyD');
    await page.evaluate(async()=>{const{Audio}=await import('esengine');const state=__executionFixture;state.video.play();state.app.getResource(Audio).resume();await state.app.tick(1/60);await state.app.stepFrames(5);});
    await page.waitForTimeout(200);const after=await facts();assert.deepEqual(after,held);assert.equal(after.clicks,1);
    assert(await page.evaluate(()=>__audioContexts.every(context=>context.state==='suspended')));
    await page.evaluate(()=>{__releaseA();__releaseA();});await page.waitForTimeout(80);assert.deepEqual(await facts(),held);
    await page.evaluate(()=>__releaseB());await page.waitForFunction(()=>__executionFixture.video.isPlaying&&__audioContexts.every(context=>context.state==='running'));
    await page.waitForTimeout(100);const resumed=await facts();assert(resumed.frame>held.frame);assert(resumed.mediaTime!==held.mediaTime);assert.equal(resumed.clicks,1);
    await page.mouse.click(point.x,point.y);await page.waitForFunction(()=>__executionFixture.clicks===2);
    await page.evaluate(()=>{__executionFixture.app.setPaused(true);window.__releaseC=__executionFixture.app.holdExecution();});
    await page.evaluate(()=>__releaseC());assert(await page.evaluate(()=>__executionFixture.app.isPaused()));
    const file='resumed.png';await page.screenshot({path:path.join(out,file)});report.screenshot={file,sha256:sha(path.join(out,file))};
    report.observations.push({stage:'resumed',...resumed});
    assert.deepEqual(report.errors,[]);assert.deepEqual(report.unexpectedRequests,[]);
    assert.deepEqual(Object.fromEntries(files().map(file=>[file,sha(path.join(root,file))])),identities);report.status='checks-passed';
} catch(error) {
    report.failure=String(error);
    if(page) {
        report.failureFacts=await page.evaluate(()=>{const state=window.__executionFixture;return{clicks:state?.clicks,held:state?.app.isExecutionHeld(),
            video:state?.video?{ready:state.video.isReady,playing:state.video.isPlaying,time:state.video.currentTime,width:state.video.width}:null,
            box:window.__estellaCooked?.probe(['ExecutionProbe']).at.ExecutionProbe};}).catch(()=>null);
        await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});
    }
    throw error;
} finally {fs.writeFileSync(path.join(out,'runtime-check.json'),JSON.stringify(report,null,2));await browser.close();await new Promise(resolve=>server.close(resolve));}
console.log('Execution hold: frames, native gestures, real AudioContext and media clock passed headlessly');
