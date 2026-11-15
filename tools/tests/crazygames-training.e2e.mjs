// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/** Exported game against explicit SDK mocks; never opens a visible window. */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { toolArgs } from '../lib/toolArgs.mjs';

const ARGS = toolArgs({ dir: null, out: null, 'expect-scores': false });
if (!ARGS.dir) throw new Error('Expected --dir <CrazyGames Web export>');
const root=fs.realpathSync(ARGS.dir), out=path.resolve(ARGS.out ? ARGS.out : 'output/crazygames-training-check');
fs.mkdirSync(out,{recursive:true});
const sha=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const files=(under='')=>fs.readdirSync(path.join(root,under),{withFileTypes:true}).flatMap(entry=>{
    const file=under ? `${under}/${entry.name}` : entry.name;
    if (entry.isDirectory()) return files(file);
    if (!entry.isFile()) throw new Error(`Unsupported entry ${file}`);
    return [file];
});
const identities=Object.fromEntries(files().map(file=>[file,sha(path.join(root,file))]));
const config=JSON.parse(fs.readFileSync(path.join(root,'game.config.json'),'utf8'));
const expectsScores=ARGS['expect-scores'];
assert.equal(Boolean(config.leaderboardEncryptionKey),expectsScores,'Export must match the score test mode');
if(expectsScores)assert.equal(config.leaderboardEncryptionKey,Buffer.alloc(32,7).toString('base64'),'Use the mock fixture client key');
const mime={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.json':'application/json','.wasm':'application/wasm','.png':'image/png'};
const server=http.createServer((req,res)=>{
    try {
        const name=decodeURIComponent(new URL(req.url,'http://localhost').pathname).slice(1) || 'index.html';
        const file=fs.realpathSync(path.resolve(root,name));
        if (!file.startsWith(root+path.sep) || !fs.statSync(file).isFile()) throw new Error('Outside export');
        res.setHeader('Content-Type',mime[path.extname(file)] ?? 'application/octet-stream');res.end(fs.readFileSync(file));
    } catch {res.writeHead(404);res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true,args:['--enable-unsafe-swiftshader','--use-angle=swiftshader','--mute-audio']});
const report={mode:'local-mock',headless:true,status:'failed',identities,verifierSha256:sha(new URL(import.meta.url)),cases:[],
    pending:['Official CrazyGames QA','Production ad fill','Cross-account cloud restoration','Physical-device and audible quality acceptance','Leaderboards']};
try {
    for (const mode of ['normal','init-failed','sdk-missing','save-disabled','save-corrupt']) {
        const context=await browser.newContext({viewport:{width:800,height:450}}), page=await context.newPage();
        const observation={mode,status:'failed',errors:[],unexpectedRequests:[]};report.cases.push(observation);
        page.on('pageerror',error=>observation.errors.push(String(error)));
        await page.addInitScript(()=>{
            window.__audioContexts=[];const Original=window.AudioContext;
            if (Original) window.AudioContext=class extends Original {constructor(...args){super(...args);window.__audioContexts.push(this);}};
        });
        await context.route('**/*',async route=>{
            const url=route.request().url();
            if (url.startsWith(origin+'/')) return route.continue();
            if (url==='https://sdk.crazygames.com/crazygames-sdk-v3.js') return route.fulfill({contentType:'text/javascript',body:mode==='sdk-missing' ? '' : `
                window.__events=[];window.__settingsListeners=new Set();window.__scores=[];
                window.__data=new Map(JSON.parse(localStorage.getItem('__crazygames_mock_data') ?? '[]'));
                ${mode==='save-corrupt' ? `__data.set('estella.storage.v1',JSON.stringify({'esengine:mobile-controls.training-credits.v1':'broken'}));` : ''}
                const record=event=>__events.push(event);
                window.CrazyGames={SDK:{
                    init(){record('init');return ${mode==='init-failed' ? 'Promise.reject(new Error("blocked"))' : 'Promise.resolve()'}},
                    game:{settings:{muteAudio:true},loadingStart(){record('loading')},loadingStop(){record('loaded')},
                        gameplayStart(){record('start')},gameplayStop(){record('stop')},
                        addSettingsChangeListener(cb){__settingsListeners.add(cb)},removeSettingsChangeListener(cb){__settingsListeners.delete(cb)}},
                    ad:{requestAd(type,cb){record(type);window.__ad=cb;cb.adStarted()}},
                    user:{submitScore(payload){record('score');__scores.push(payload)}},
                    data:{getItem(key){${mode==='save-disabled' ? 'throw new Error("Progress Save disabled");' : 'return __data.get(key) ?? null;'}},
                        setItem(key,value){__data.set(key,value);localStorage.setItem('__crazygames_mock_data',JSON.stringify([...__data]))},removeItem(key){__data.delete(key)}}
                }};
                window.__mute=value=>{CrazyGames.SDK.game.settings.muteAudio=value;for(const cb of __settingsListeners)cb({muteAudio:value})};
            `});
            observation.unexpectedRequests.push(url);return route.abort();
        });
        try {
            await page.goto(origin+'/?headless');
            await page.waitForFunction(()=>window.__estellaCooked?.probe(['DeviceStatus']).at.DeviceStatus?.text,{}, {timeout:30000});
            await page.waitForFunction(()=>!document.getElementById('es-splash'));
            const click=async name=>{
                const box=await page.evaluate(n=>__estellaCooked.probe([n]).at[n],name);assert(box,`Missing ${name}`);
                await page.mouse.click(400+box.x,225-box.y);
            };
            const phase=value=>page.waitForFunction(v=>window.__estellaCooked?.probe(['DeviceStatus']).at.DeviceStatus?.text?.startsWith(v),value.toUpperCase());
            const active=mode==='normal'||mode==='save-disabled'||mode==='save-corrupt';
            assert.equal(await page.evaluate(async()=>(await import('esengine')).Scores.available),active && expectsScores);
            assert.deepEqual(await page.evaluate(()=>window.__events ?? []),mode==='sdk-missing' ? [] : active ? ['init','loading','loaded'] : ['init']);
            await click('TrainingStart');await phase('playing');
            if (active) {
                await page.waitForFunction(()=>__audioContexts.length>0 && __audioContexts.every(c=>c.state==='suspended'));
                await page.evaluate(()=>__mute(false));
                await page.waitForFunction(()=>__audioContexts.every(c=>c.state==='running'));
                const before=await page.evaluate(()=>__events.slice());
                await page.evaluate(()=>{document.dispatchEvent(new Event('visibilitychange'));window.dispatchEvent(new Event('pagehide'));window.dispatchEvent(new Event('pageshow'));});
                assert.deepEqual(await page.evaluate(()=>__events),before);
                await phase('playing');
                await page.evaluate(()=>__mute(true));
                await click('TrainingReward');await phase('ad');
                await page.evaluate(()=>__ad.adFinished());await phase('playing');
                await page.waitForFunction(()=>__audioContexts.every(c=>c.state==='suspended'));
                await page.evaluate(()=>__mute(false));
                await page.waitForFunction(()=>__audioContexts.every(c=>c.state==='running'));
                assert.match(await page.evaluate(()=>__estellaCooked.probe(['DeviceStatus']).at.DeviceStatus.text),/Credits: 1/);
                await click('TrainingReward');await phase('ad');await page.evaluate(()=>__ad.adError(new Error('no fill')));await phase('playing');
                assert.match(await page.evaluate(()=>__estellaCooked.probe(['DeviceStatus']).at.DeviceStatus.text),/Credits: 1/);
                await click('TrainingPause');await phase('paused');await click('TrainingStart');await phase('ad');
                await page.evaluate(()=>__ad.adFinished());await phase('playing');
                observation.gameplayEvents=await page.evaluate(()=>__events.slice());
                assert.deepEqual(observation.gameplayEvents,['init','loading','loaded','start','stop','rewarded','start','stop','rewarded','start','stop','midgame','start']);
                if(expectsScores) {
                    const at=await page.evaluate(()=>__estellaCooked.probe(['Player','Target']).at);
                    if(Math.abs(at.Target.y-at.Player.y)>15) {
                        const vertical=at.Target.y>at.Player.y?'KeyW':'KeyS';await page.keyboard.down(vertical);
                        await page.waitForFunction(()=>{const p=__estellaCooked.probe(['Player','Target']).at;return Math.abs(p.Player.y-p.Target.y)<15;});await page.keyboard.up(vertical);
                    }
                    const current=await page.evaluate(()=>__estellaCooked.probe(['Player','Target']).at);
                    const horizontal=current.Target.x>current.Player.x?'KeyD':'KeyA';await page.keyboard.down(horizontal);
                    await page.waitForFunction(()=>{const p=__estellaCooked.probe(['Player','Target']).at;return Math.hypot(p.Player.x-p.Target.x,p.Player.y-p.Target.y)<60;});await page.keyboard.up(horizontal);
                    for(let hit=0;hit<3;hit++){await page.keyboard.press('Space',{delay:80});await page.waitForTimeout(80);}
                    await phase('finished');await click('TrainingScore');
                    await page.waitForFunction(()=>__estellaCooked.probe(['DeviceStatus']).at.DeviceStatus.text.includes('Score sent'));
                    observation.score=await page.evaluate(async()=>{
                        const payload=__scores[0],bytes=Uint8Array.from(atob(payload.encryptedScore),char=>char.charCodeAt(0));
                        const key=await crypto.subtle.importKey('raw',new Uint8Array(32).fill(7),{name:'AES-GCM'},false,['decrypt']);
                        const plaintext=await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes.slice(0,12)},key,bytes.slice(12));
                        return {score:payload.score,decrypted:new TextDecoder().decode(plaintext),count:__scores.length};
                    });
                    assert.deepEqual(observation.score,{score:3,decrypted:'3',count:1});
                }
                if(mode==='normal') {
                    await page.reload();await phase('menu');await page.waitForFunction(()=>!document.getElementById('es-splash'));
                    observation.restoredCredits=await page.evaluate(()=>__estellaCooked.probe(['DeviceStatus']).at.DeviceStatus.text);
                    assert.match(observation.restoredCredits,/Credits: 1/);
                } else {
                    assert.match(await page.evaluate(()=>__estellaCooked.probe(['DeviceStatus']).at.DeviceStatus.text),/Save unavailable/);
                    if(mode==='save-corrupt')assert.equal(await page.evaluate(()=>JSON.parse(__data.get('estella.storage.v1'))['esengine:mobile-controls.training-credits.v1']),'broken');
                }
                observation.storage=await page.evaluate(async()=>{
                    const {Storage}=await import('esengine');
                    try {Storage.setString('training-check','retained');const restored=Storage.getString('training-check');
                        CrazyGames.SDK.data.setItem('publisher-data','keep');Storage.clear();
                        return {restored,cleared:Storage.has('training-check'),publisher:CrazyGames.SDK.data.getItem('publisher-data')};
                    } catch(error) {return {error:String(error),localFallback:localStorage.getItem('esengine:training-check')};}
                });
                if (mode!=='save-disabled') assert.deepEqual(observation.storage,{restored:'retained',cleared:false,publisher:'keep'});
                else {assert.match(observation.storage.error,/Progress Save disabled/);assert.equal(observation.storage.localFallback,null);}
            } else {
                assert.match(await page.evaluate(()=>__estellaCooked.probe(['TrainingReward']).at.TrainingReward ? __estellaCooked.probe(['DeviceStatus']).at.DeviceStatus.text : ''),/Credits: 0/);
                observation.storage=await page.evaluate(async()=>{try{(await import('esengine')).Storage.setString('training-check','bad');return 'unexpected success';}catch(error){return String(error);}});
                assert.match(observation.storage,/storage unavailable/);
                assert.deepEqual(await page.evaluate(()=>window.__events ?? []),mode==='sdk-missing' ? [] : ['init']);
            }
            const screenshot=`${mode}.png`;await page.screenshot({path:path.join(out,screenshot)});
            observation.screenshot={file:screenshot,sha256:sha(path.join(out,screenshot))};
            assert.deepEqual(observation.errors,[]);assert.deepEqual(observation.unexpectedRequests,[]);
            observation.events=await page.evaluate(()=>window.__events ?? []);observation.status='passed';
        } catch(error) {observation.failure=String(error);throw error;}
        finally {await context.close();}
    }
    assert.deepEqual(Object.fromEntries(files().map(file=>[file,sha(path.join(root,file))])),identities);
    report.status='checks-passed';
} finally {
    fs.writeFileSync(path.join(out,'runtime-check.json'),JSON.stringify(report,null,2));
    await browser.close();await new Promise(resolve=>server.close(resolve));
}
console.log(`CrazyGames local mock checks: ${report.cases.length} passed`);
