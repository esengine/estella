// SPDX-License-Identifier: Apache-2.0
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';
import { serveHost } from './lib/staticServer.mjs';
import { toolArgs } from './lib/toolArgs.mjs';
import { ROOT as root } from './lib/repo.mjs';
const ARGS = toolArgs({ dir: null, out: null });
const dir = path.resolve(ARGS.dir ?? 'output/navigation-workshop-web');
const out = path.resolve(ARGS.out ?? 'output/navigation-workshop-check');
const files = (under, prefix='') => fs.readdirSync(under,{withFileTypes:true}).flatMap(e=>e.isDirectory()
    ? files(path.join(under,e.name),prefix+e.name+'/') : [prefix+e.name]);
const identity={source:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8',windowsHide:true}).trim(),
    sourceDirtyFiles:execFileSync('git',['status','--porcelain=1','--untracked-files=all','--','sdk/src/ai/nav','examples/navigation-workshop','tools/verify-navigation-workshop.mjs'],{cwd:root,encoding:'utf8',windowsHide:true}).split('\n').filter(Boolean),
    exportHashes:Object.fromEntries(files(dir).map(file=>[file,createHash('sha256').update(fs.readFileSync(path.join(dir,file))).digest('hex')]))};
fs.mkdirSync(out, { recursive: true });
const server = await serveHost(dir);
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader','--use-angle=swiftshader','--mute-audio'] });
const records = [], errors = [];
// Yield to the compositor between fixed simulation batches. Software GL must
// consume its render queue before a screenshot; simulation time stays fixed.
const advance = async (page, frames) => {
    for(let done=0;done<frames;done+=30) {
        await page.evaluate(n=>window.__estellaCooked.step(n,1/60),Math.min(30,frames-done));
        await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>resolve())));
    }
};
// Sample trusted key edges before the paused animation loop clears frame input.
const pressAndStep = async (page, code) => {
    await page.evaluate(code => {
        window.__workshopKeyStep = new Promise((resolve, reject) => {
            const sample = event => {
                if (event.code !== code) return;
                window.removeEventListener('keydown', sample);
                window.__estellaCooked.step(1, 1/60).then(resolve, reject);
            };
            window.addEventListener('keydown', sample);
        });
    }, code);
    await page.keyboard.down(code);
    await page.evaluate(() => window.__workshopKeyStep);
    await page.keyboard.up(code);
    await page.evaluate(() => window.__estellaCooked.step(1, 1/60));
};
try {
    const page = await browser.newPage({viewport:{width:1024,height:720}});
    page.on('pageerror', error => errors.push(String(error)));
    page.on('console', message => fs.appendFileSync(path.join(out,'console.log'),message.type()+': '+message.text()+'\n'));
    await page.goto(origin+'/?headless');
    await page.waitForFunction(() => {const f=window.__estellaCooked?.facts();return f?.couriers===8 && f.waiting+f.arrived===8;}, {}, {timeout:30000});
    await page.waitForFunction(()=>{const e=document.getElementById('es-splash');return !e||Number(getComputedStyle(e).opacity)===0;});
    const facts = () => page.evaluate(() => window.__estellaCooked.facts());
    const paused = value => page.evaluate(v => window.__estellaCooked.setPaused(v), value);
    const step = n => advance(page,n);
    const click = async name => {
        await paused(false);
        const box = await page.evaluate(name => window.__estellaCooked.probe([name]).at[name], name);
        assert(box, 'Missing '+name);
        await page.mouse.click(512+box.x,360-box.y);
        await page.waitForTimeout(350); // Run the real UI event and navigation ticks before pausing.
        await paused(true);
    };
    const snapshot = async name => {
        const value = await facts();
        const positions=await page.evaluate(n=>window.__estellaCooked.probe(Array.from({length:n},(_,i)=>`Courier ${String(i+1).padStart(2,'0')}`)).at,value.couriers);
        records.push({name,facts:value,positions});
        fs.writeFileSync(path.join(out,'observations.json'),JSON.stringify({...identity,records,errors},null,2));
        await page.screenshot({path:path.join(out,name+'.png')});
        return value;
    };
    await snapshot('courtyard');
    await click('GateButton');
    assert.equal((await facts()).gateClosed,true,'Gate did not close through its UI button');
    await step(480);
    const closed = await snapshot('gate-closed');
    assert.equal(closed.arrived,0,'A partial approach was reported as arrival');
    assert.equal(closed.leftOfGate,8,'A courier crossed the closed gate');
    await click('GateButton');
    assert.equal((await facts()).gateClosed,false);
    await click('GateButton');
    assert.equal((await facts()).gateClosed,false,'Gate closed onto a courier occupying its approach');
    assert((await page.evaluate(()=>window.__estellaCooked.probe(['WorkshopStatus']).at.WorkshopStatus.text)).includes('Gate occupied'));
    await step(900);
    const reopened = await snapshot('gate-reopened');
    assert.equal(reopened.arrived,8,'Waiting couriers did not resume their retained destinations');
    await click('BuildButton');
    assert.equal((await facts()).warehousePlaced,true);
    await click('ResetButton');
    const simulate = (frames,count) => page.evaluate(async ({frames,count}) => {
        const host = window.__estellaCooked, names = Array.from({length:count},(_,i)=>`Courier ${String(i+1).padStart(2,'0')}`);
        const trail = [], overlaps = []; let maxPenetration = 0;
        for(let i=0;i<frames;i++) {
            await host.step(1,1/60);
            const at = host.probe(names).at;
            for(const name of names) { const p=at[name]; if(!p)continue;
                const distance=Math.hypot(Math.max(0,Math.abs(p.x+160)-46),Math.max(0,Math.abs(p.y)-46));
                maxPenetration=Math.max(maxPenetration,8-distance);
                // Float32 position tolerance, in world pixels (tile width 32).
                if(distance<8-0.001)overlaps.push({frame:i,name,x:p.x,y:p.y,distance}); }
            if(i%10===0)trail.push(at['Courier 07']);
            if(i%30===29)await new Promise(resolve=>requestAnimationFrame(()=>resolve()));
        }
        return {trail,overlaps,maxPenetration,contactTolerance:0.001,facts:host.facts(),positions:host.probe(names).at};
    },{frames,count});
    const trace = await simulate(900,8);
    records.push({name:'warehouse-trace',...trace});
    fs.writeFileSync(path.join(out,'observations.json'),JSON.stringify({...identity,records,errors},null,2));
    assert.equal(trace.overlaps.length,0,'Courier body entered the placed warehouse');
    assert(trace.trail.some(p=>p && p.x>-214 && p.x<-106 && Math.abs(p.y)>=54),'No observed detour around the storehouse');
    assert.equal(trace.facts.arrived,8,'Storehouse detour did not finish');
    await snapshot('storehouse');
    // Paused key input makes the first 24-agent planning tick observable rather
    // than relying on catching a one-frame queue with wall-clock polling.
    await pressAndStep(page, 'KeyC');
    const queued = await snapshot('crowd-queued');
    assert.equal(queued.couriers,24);
    assert(queued.queuedPlans>=8,'The actual scene did not expose the 16-plan count limit');
    const crowdTrace=await simulate(1800,24);
    records.push({name:'crowd-trace',...crowdTrace});
    fs.writeFileSync(path.join(out,'observations.json'),JSON.stringify({...identity,records,errors},null,2));
    assert.equal(crowdTrace.overlaps.length,0,'Crowded courier body entered the warehouse beyond contact skin');
    const crowd = await snapshot('crowd-delivered');
    assert.equal(crowd.arrived,24,'Crowded delivery did not complete');
    const manifest=JSON.parse(fs.readFileSync(path.join(dir,'asset-manifest.json'),'utf8'));
    const terrain=Object.values(manifest.groups).map(g=>g.assets['25e7e0fe-e665-4af2-ac71-777177b4c006']).find(Boolean);
    assert(terrain,'Missing packaged terrain JSON');
    const terrainUrl=origin+'/'+terrain.path,heldRequests=[];
    await page.route(terrainUrl,route=>{heldRequests.push(route);});
    await click('ResetButton');
    const firstRequest=page.waitForRequest(terrainUrl);
    await click('ReloadButton');await firstRequest;
    const cancelledVersion=(await facts()).reloadVersion;
    const positions=()=>page.evaluate(()=>window.__estellaCooked.probe(Array.from({length:24},(_,i)=>`Courier ${String(i+1).padStart(2,'0')}`)).at);
    const beforeHold=await positions();await step(180);
    const afterHold=await positions();
    records.push({name:'reload-hold-positions',frames:180,dt:1/60,before:beforeHold,after:afterHold});
    fs.writeFileSync(path.join(out,'observations.json'),JSON.stringify({...identity,records,errors},null,2));
    assert.deepEqual(afterHold,beforeHold,'A pending terrain update moved couriers on the old route');
    assert.equal((await snapshot('reload-held')).reloadPending,true);
    await click('CancelReloadButton');
    assert.equal((await facts()).reloadCancelled,cancelledVersion);
    await heldRequests.shift().continue();
    await page.waitForFunction(v=>window.__estellaCooked.facts().reloadSettled>=v,cancelledVersion);
    assert.equal((await facts()).reloadCommitted,0,'A cancelled terrain result was installed');
    await step(1800);
    assert.equal((await snapshot('reload-cancelled')).arrived,24,'Cancellation did not resume old routes');
    await click('ResetButton');
    const secondRequest=page.waitForRequest(terrainUrl);
    await click('ReloadButton');await secondRequest;
    const supersededVersion=(await facts()).reloadVersion;
    await click('ReloadButton');
    const latestVersion=(await facts()).reloadVersion;
    assert(latestVersion>supersededVersion,'A replacement request did not advance its version');
    await heldRequests.shift().continue();
    await page.waitForFunction(v=>{const f=window.__estellaCooked.facts();return !f.reloadPending&&f.reloadCommitted===v&&f.reloadSettled>=v;},latestVersion);
    const replacementTrace=await simulate(1800,24);
    records.push({name:'reload-committed-trace',...replacementTrace});
    fs.writeFileSync(path.join(out,'observations.json'),JSON.stringify({...identity,records,errors},null,2));
    assert.equal(replacementTrace.overlaps.length,0,'Reloaded terrain lost its live warehouse obstacle');
    assert.equal(replacementTrace.facts.arrived,24,'Replacement terrain did not resume retained destinations');
    await snapshot('reload-committed');
    await click('ResetButton');
    const failedRequest=page.waitForRequest(terrainUrl);
    await click('ReloadButton');await failedRequest;
    const failedVersion=(await facts()).reloadVersion;
    await heldRequests.shift().fulfill({contentType:'application/json',body:JSON.stringify({width:0})});
    await page.waitForFunction(v=>{const f=window.__estellaCooked.facts();return !f.reloadPending&&f.reloadFailed===v&&f.reloadSettled>=v;},failedVersion);
    assert.equal((await facts()).reloadCommitted,latestVersion,'Invalid terrain replaced the live grid');
    const failedTrace=await simulate(1800,24);
    records.push({name:'reload-failed-trace',responseOverride:{width:0},...failedTrace});
    fs.writeFileSync(path.join(out,'observations.json'),JSON.stringify({...identity,records,errors},null,2));
    assert.equal(failedTrace.overlaps.length,0,'Failed reload changed the active warehouse footprint');
    assert.equal(failedTrace.facts.arrived,24,'Failed terrain reload did not resume the retained grid');
    await snapshot('reload-failed');
    await page.unroute(terrainUrl);
    const touch=await browser.newPage({viewport:{width:768,height:540},hasTouch:true,isMobile:true});
    touch.on('pageerror',error=>errors.push(String(error)));
    await touch.goto(origin+'/?headless');
    await touch.waitForFunction(()=>window.__estellaCooked?.facts().waiting===8);
    await touch.waitForFunction(()=>{const e=document.getElementById('es-splash');return !e||Number(getComputedStyle(e).opacity)===0;});
    const box=await touch.evaluate(()=>window.__estellaCooked.probe(['GateButton']).at.GateButton);
    await touch.touchscreen.tap(384+box.x*.75,270-box.y*.75);
    await touch.waitForFunction(()=>window.__estellaCooked.facts().gateClosed===true);
    await touch.screenshot({path:path.join(out,'touch-landscape.png')});
    records.push({name:'touch-landscape',facts:await touch.evaluate(()=>window.__estellaCooked.facts())});
    // Exercise authored obstacle state without changing the exported files.
    const authoredScene=JSON.parse(fs.readFileSync(path.join(dir,'assets/scenes/main.esscene'),'utf8'));
    for(const name of ['Gate','Warehouse']) {
        const obstacle=authoredScene.entities.find(e=>e.name===name)?.components.find(c=>c.type==='NavObstacle');
        assert(obstacle,'Missing authored obstacle '+name); obstacle.data.enabled=true;
    }
    const authoredBody=JSON.stringify(authoredScene);
    const authored=await browser.newPage({viewport:{width:1024,height:720}});
    authored.on('pageerror',error=>errors.push(String(error)));
    let sceneRequests=0;
    await authored.route('**/assets/scenes/main.esscene',route=>{
        sceneRequests++; return route.fulfill({contentType:'application/json',body:authoredBody});
    });
    await authored.goto(origin+'/?headless');
    await authored.waitForFunction(()=>{const f=window.__estellaCooked?.facts();return f?.couriers===8 && f.waiting+f.arrived===8;});
    await authored.waitForFunction(()=>{const e=document.getElementById('es-splash');return !e||Number(getComputedStyle(e).opacity)===0;});
    assert(sceneRequests>0,'Authored scene override was not loaded');
    await authored.evaluate(()=>window.__estellaCooked.setPaused(true));
    await advance(authored,480);
    const initial=await authored.evaluate(()=>window.__estellaCooked.facts());
    assert.equal(initial.gateClosed,true,'Authored closed gate was reset at startup');
    assert.equal(initial.warehousePlaced,true,'Authored warehouse was reset at startup');
    assert.equal(initial.arrived,0); assert.equal(initial.leftOfGate,8);
    await pressAndStep(authored, 'KeyG');
    await advance(authored,1200);
    const delivered=await authored.evaluate(()=>window.__estellaCooked.facts());
    assert.equal(delivered.gateClosed,false); assert.equal(delivered.warehousePlaced,true);
    assert.equal(delivered.arrived,8,'Authored obstacle layout did not resume delivery after opening');
    await authored.screenshot({path:path.join(out,'authored-obstacles.png')});
    records.push({name:'authored-obstacles',initial,facts:delivered,
        sceneOverride:{path:'assets/scenes/main.esscene',enabled:['Gate','Warehouse'],sha256:createHash('sha256').update(authoredBody).digest('hex')}});
    assert.equal(errors.length,0,errors.join('\n'));
    fs.writeFileSync(path.join(out,'observations.json'),JSON.stringify({...identity,status:'passed',records,errors},null,2));
    console.log('Workshop Web export: gate retention, crowd delivery, authored obstacles and terrain reload/cancel/supersede/failure passed.');
} finally { await browser.close(); await new Promise(resolve=>server.close(resolve)); }
