import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { serveHost } from '../../../tools/lib/staticServer.mjs';

const root=path.resolve('output/cyber-rooftop');
await mkdir(root,{recursive:true});
const server=await serveHost(path.join(root,'web'));
const browser=await chromium.launch({headless:true,args:['--use-angle=d3d11','--enable-webgl','--ignore-gpu-blocklist','--enable-unsafe-swiftshader']});
const errors=[],warnings=[],checks=[];
try {
    const page=await browser.newPage({viewport:{width:1672,height:940},deviceScaleFactor:1});
    page.on('pageerror',e=>errors.push(String(e)));
    page.on('console',m=>{if(m.type()==='error')errors.push(m.text());if(m.type()==='warning')warnings.push(m.text());});
    page.on('response',r=>{if(r.status()>=400)errors.push(`${r.status()} ${r.url()}`);});
    await page.goto(`http://127.0.0.1:${server.address().port}/?headless`,{waitUntil:'load'});
    await page.waitForFunction(()=>window.__estellaCooked?.facts().ready,null,{timeout:60000});
    await page.evaluate(()=>window.__estellaCooked.setPaused(true));
    const step=async(n=2)=>page.evaluate(n=>window.__estellaCooked.step(n),n);
    const facts=()=>page.evaluate(()=>window.__estellaCooked.facts());
    const probe=(names)=>page.evaluate(names=>window.__estellaCooked.probe(names).at,names);
    const paused=value=>page.evaluate(value=>window.__estellaCooked.setPaused(value),value);
    const observeFrames=async()=>{const start=(await facts()).frame;await page.waitForFunction(start=>window.__estellaCooked.facts().frame>=start+2,start);};
    // Paused rendering can retire input edges without running gameplay. Deliver
    // real browser input while the game is running, then observe it paused.
    const key=async(code,n=1)=>{
        await paused(false);await page.keyboard.down(code);await observeFrames();await paused(true);
        if(n>1)await step(n);await page.keyboard.up(code);await step();
    };
    const click=async(x=820,y=490)=>{
        await paused(false);await page.mouse.move(x,y);await page.mouse.down();await observeFrames();
        await page.mouse.up();await observeFrames();await paused(true);await step();
    };
    await step(90);
    assert.equal((await facts()).valid,true);
    const shadows=await page.evaluate(()=>['Moon fill','Warm entrance','Upper grow pink','Canopy warm'].map(name=>({name,...window.__estellaCooked.decisions(name)?.shadow})));
    assert.deepEqual(shadows.map(s=>s.requested),[1,6,1,1]);
    assert.ok(shadows.every(s=>s.granted===s.requested&&s.deniedCasters===0&&s.reducedCasters===0));
    checks.push('All four native shadow casters receive complete maps within nine tiles');
    await page.screenshot({path:path.join(root,'actual.png')});
    checks.push('Native scene boot, all assets, 2D HUD and 3D geometry');
    await key('r');assert.equal((await facts()).rotation,1);
    await key('r');await key('r');await key('r');assert.equal((await facts()).rotation,0);
    checks.push('Four-way placement rotation');
    await click();
    const built=await facts();assert.equal(built.placed,1);assert.equal(built.steel,20);assert.equal(built.circuits,14);
    assert.equal(built.valid,false);
    await click();assert.equal((await facts()).placed,1);assert.equal((await facts()).steel,20);
    checks.push('Placement consumes resources once; overlap is rejected');
    await key('Escape');assert.equal((await facts()).building,false);
    await click();assert.equal((await facts()).placed,1);
    await key('b');assert.equal((await facts()).building,true);
    checks.push('Cancel / restore building without accidental placement');
    const before=(await probe(['Camera'])).Camera;
    await key('d',100);
    const after=(await probe(['Camera'])).Camera;
    assert.ok(after.x>before.x+3,'WASD must move the actual camera');
    await key('5');assert.equal((await facts()).selected,5);
    assert.equal((await facts()).valid,true);
    await click();const water=await facts();
    assert.equal(water.purifiers,1);assert.equal(water.steel,12);assert.equal(water.circuits,10);
    const hud=await probe(['Water objective','Vital value 2']);
    assert.ok(hud['Water objective'].text.includes('1/1'));assert.equal(hud['Vital value 2'].text,'84%');
    checks.push('Movement, water-filter construction, HUD task and water updates');
    await page.screenshot({path:path.join(root,'built.png')});
    await key('Home');assert.ok(Math.abs((await facts()).cameraX-6)<.001);
    await click(480,845);assert.equal((await facts()).selected,1);assert.equal((await facts()).building,false);
    await click(780,845);assert.equal((await facts()).selected,4);
    checks.push('Native clickable quickbar and reference-camera reset');
    // Real keys drive the camera into the roof bound; there is no test-only teleport.
    await key('s',220);const edge=await facts();assert.ok(edge.cameraZ<=20.01);
    checks.push('Rooftop walking boundary');
    const trainBefore=(await probe(['Train'])).Train.x;await step(30);
    assert.notEqual((await probe(['Train'])).Train.x,trainBefore);
    const particles=await page.evaluate(()=>window.__estellaCooked.particles(['Rain','Steam 10']));
    assert.ok(particles.Rain>0);assert.ok(particles['Steam 10']>0);
    checks.push('Animated train, rain and steam');
    await page.setViewportSize({width:1280,height:720});await key('Home');await step(4);
    await page.screenshot({path:path.join(root,'1280x720.png')});
    assert.deepEqual(errors,[]);assert.deepEqual(warnings,[]);
    const report={status:'passed',checks,errors,warnings,facts:await facts(),particles,editorAcceptance:'not run locally; CI only',visualAcceptance:'Runtime reconstruction; not pixel-identical to the concept reference.'};
    await writeFile(path.join(root,'verification.json'),JSON.stringify(report,null,2)+'\n');
    await rm(path.join(root,'verification-failure.json'),{force:true});
    console.log(JSON.stringify(report,null,2));
}catch(error){await writeFile(path.join(root,'verification-failure.json'),JSON.stringify({error:String(error),errors,warnings,checks},null,2));throw error;}
finally{await browser.close();server.close();}
