// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
// Genuine headless Chromium, shipped SDK + WASM, and the engine-owned render host.
import { chromium } from 'playwright';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile, realpath, mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { requireCurrentEngine } from '../lib/engineBuild.mjs';
const { PNG } = createRequire(new URL('../../pipeline/package.json', import.meta.url))('pngjs');
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
requireCurrentEngine(repo, path.join(repo, 'build/render-host/wasm'));
const prepass = process.argv.includes('--prepass');
const out = path.join(repo, `output/rm044-runtime${prepass ? '-prepass' : ''}`);
await mkdir(out, { recursive: true });
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/favicon.ico') { res.writeHead(204).end(); return; }
    const under = decodeURIComponent(url.pathname);
    const scenes = under.startsWith('/scenes/');
    const root = await realpath(path.join(repo, scenes ? 'fixtures/scenes' : 'build/render-host'));
    const file = await realpath(path.resolve(root, scenes ? under.slice(8) : under.slice(1) || 'index.html'));
    if (!file.startsWith(root + path.sep)) throw Error('Outside host');
    res.setHeader('Content-Type', ({'.js':'text/javascript','.wasm':'application/wasm','.html':'text/html'})[path.extname(file)] ?? 'application/octet-stream');
    res.end(await readFile(file));
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ channel: 'chromium', headless: true, args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--mute-audio'] });
const report = { status: 'failed', mode: 'headless-engine', prepass, checks: [], deviceAcceptance: 'pending' };
try {
  const backends = process.argv.includes('--webgl-only') ? ['webgl2'] : ['webgl2', 'webgpu'];
  for (const backend of backends) {
    const page = await browser.newPage({ viewport: {width:512,height:512} });
    const errors = [];
    const lossLogs = [];
    let injectingLoss = false;
    report.activeBackend = backend;
    report.errors = errors;
    page.on('pageerror', e => errors.push(String(e)));
    page.on('console', msg => { if (msg.type() === 'error') (injectingLoss ? lossLogs : errors).push(msg.text()); });
    await page.goto(`http://127.0.0.1:${server.address().port}/?w=512&h=512&backend=${backend}&prepass=${prepass ? 1 : 0}`);
    await page.evaluate(async () => { await window.__estellaHeadless.ready; });
    await page.evaluate(() => window.__estellaHeadless.api.setCpuProfiling(true));
    const load = await page.evaluate(() => window.__estellaHeadless.api.loadScene('/scenes/planar-reflection.esscene'));
    assert.deepEqual(load.missing, []);
    const step = n => page.evaluate(n => window.__estellaHeadless.api.step(n), n);
    const field = (id, component, key, value) => page.evaluate(({id,component,key,value}) => window.__estellaHeadless.api.setField(id,component,key,'',value), {id,component,key,value});
    const status = () => page.evaluate(() => window.__estellaHeadless.api.planarReflectionStatus(2,1));
    const capture = async name => {
      const raw = await page.evaluate(async () => {
        const p = await window.__estellaHeadless.api.captureViewportPixels();
        return {width:p.width,height:p.height,data:Array.from(p.rgba)};
      });
      const image = new PNG({width:raw.width,height:raw.height});
      // The engine readback contract is bottom-up on both backends; PNG is top-down.
      const pixels = Buffer.from(raw.data), stride = raw.width * 4;
      for (let y=0;y<raw.height;y++) pixels.copy(image.data,y*stride,(raw.height-1-y)*stride,(raw.height-y)*stride);
      await writeFile(path.join(out, `${backend}-${name}.png`), PNG.sync.write(image));
      return image;
    };
    const changed = (a,b,startY=0,tolerance=40) => {
      let count=0;
      for(let i=startY*a.width*4;i<a.data.length;i+=4) {
        if(Math.abs(a.data[i]-b.data[i])+Math.abs(a.data[i+1]-b.data[i+1])+Math.abs(a.data[i+2]-b.data[i+2])>tolerance) count++;
      }
      return count;
    };
    await step(3);
    const ready = await status();
    assert.equal(ready.state,'ready', JSON.stringify({ready,errors}));
    assert.equal(ready.width,512); assert.ok(ready.draws>0);
    const on = await capture('enabled');
    const drawsOn = await page.evaluate(() => window.__estellaHeadless.api.getStats().drawCalls);
    const countersOn = await page.evaluate(() => window.__estellaHeadless.api.getCounters());
    const prepassDraws = countersOn['render.planar.prepass.draws'];
    if (prepass) assert.ok(prepassDraws > 0, 'the reflection must execute its depth prepass');
    else assert.equal(prepassDraws, 0, 'the disabled quality policy must not add a depth prepass');
    await page.evaluate(() => window.__estellaHeadless.api.idleRenderFrames(8));
    assert.equal((await status()).state,'ready','cached editor frames must retain the last capture');
    await step(1);
    const pixel = (image,x,y) => Array.from(image.data.subarray((y*image.width+x)*4,(y*image.width+x)*4+3));
    for (const [x,y,r,g] of [[200,210,255,0],[200,290,255,0],[310,214,0,255],[310,268,0,255]]) {
      const c = pixel(on,x,y);
      assert.ok(Math.abs(c[0]-r)<25 && Math.abs(c[1]-g)<25 && c[2]<25, `source/reflection placement ${backend} ${x},${y}: ${c}`);
    }
    await field(2,'PlanarReflection','enabled',false); await step(3);
    assert.equal((await status()).state,'inactive');
    const off = await capture('disabled');
    const drawsOff = await page.evaluate(() => window.__estellaHeadless.api.getStats().drawCalls);
    const countersOff = await page.evaluate(() => window.__estellaHeadless.api.getCounters());
    assert.equal(drawsOn-drawsOff,ready.draws,'frame statistics must include the capture cost');
    assert.equal(countersOn['render.gpu.draws']-countersOff['render.gpu.draws'],ready.draws+prepassDraws,
      'GPU statistics must include both reflected colour draws and the depth prepass');
    assert.ok(changed(on,off,256)>100,'reflection must change the lower half of the image');
    assert.ok(pixel(off,200,290).every(c=>c<10),'disabled reflection must not leave stale pixels');
    await field(2,'PlanarReflection','enabled',true); await step(2);
    await field(5,'MeshRenderer','enabled',false); await step(2);
    const noUnderwater = await capture('below-plane-hidden');
    assert.equal(changed(on,noUnderwater),0,'opposite-half-space object must be clipped');
    await field(2,'PlanarReflection','cullingMask',4); await step(2);
    const masked = await capture('green-layer-only');
    assert.ok(pixel(masked,200,290).every(c=>c<10),'reflection mask must exclude red layer');
    assert.ok(pixel(masked,310,268)[1]>230,'reflection mask must keep green layer');
    assert.ok(pixel(masked,200,210)[0]>230,'capture mask must not change the source view');
    await field(2,'PlanarReflection','cullingMask',0xffffffff); await step(2);
    await field(3,'Transform','position.x',-0.5); await step(2);
    const moved = await capture('moved');
    assert.ok(changed(on,moved,256)>100,'moving geometry must update its reflection');
    await field(2,'PlanarReflection','update',1);
    await field(2,'PlanarReflection','updatesPerSecond',1); await step(2);
    assert.equal((await status()).updated,false,'capture rate must be independent of scene frames');
    await field(2,'PlanarReflection','update',2); await step(2);
    await field(3,'Transform','position.x',1); await step(2);
    assert.equal((await status()).updated,false,'OnDemand must keep its capture');
    await field(2,'PlanarReflection','revision',1); await step(1);
    assert.equal((await status()).updated,true,'revision requests a new capture');
    await field(2,'PlanarReflection','maxSize',128); await step(1);
    assert.equal((await status()).width,128,'resize must rebuild and refresh the target');
    assert.deepEqual(errors,[]);
    const beforeLoss = await capture('before-loss');
    injectingLoss = true;
    const recovery = await page.evaluate(async () => {
      const {device:d,api} = window.__estellaHeadless;
      const generation = d.deviceGen();
      if (!d.lose()) throw Error('Device loss injection unavailable');
      for (let i=0;i<30 && d.status()===0;i++) { await api.step(1); await new Promise(r=>setTimeout(r,50)); }
      const lost = d.status();
      d.restore();
      await new Promise(r=>setTimeout(r,500));
      let recovered = false;
      for (let i=0;i<20 && !recovered;i++) { recovered=d.recover(); if(!recovered) await new Promise(r=>setTimeout(r,100)); }
      if (!recovered || !(await d.recoverFull())) throw Error('Full device recovery failed');
      await api.step(1);
      return {lost,before:generation,after:d.deviceGen()};
    });
    injectingLoss = false;
    assert.notEqual(recovery.lost,0);
    assert.ok(recovery.after>recovery.before);
    assert.equal((await status()).updated,true,'OnDemand must refresh after device recovery');
    const afterLoss = await capture('after-loss');
    assert.equal(changed(beforeLoss,afterLoss),0,'recovered capture must match its previous content');
    assert.ok(lossLogs.every(line=>/lost|destroyed|context.*restore/i.test(line)),JSON.stringify(lossLogs));
    assert.deepEqual(errors,[]);
    await field(3,'Transform','position.x',-1.3);
    await field(2,'PlanarReflection','update',0);
    await field(2,'PlanarReflection','maxSize',512);
    await field(1,'Camera','viewport',{x:0,y:0,z:0.5,w:1});
    await field(6,'Camera','isActive',true); await step(2);
    const secondView = await page.evaluate(() => window.__estellaHeadless.api.planarReflectionStatus(2,6));
    assert.equal((await status()).width,256);
    assert.equal(secondView.width,256);
    const split = await capture('two-cameras');
    assert.ok(pixel(split,72,290)[0]>230,'first view must keep its own reflection');
    assert.ok(pixel(split,375,268)[1]>230,'second view must capture from its own camera');
    assert.deepEqual(errors,[]);

    // A fresh world: sixteen brighter lights outside the scene move the local light into the tiled list without changing its illumination.
    await page.reload();
    await page.evaluate(async () => { await window.__estellaHeadless.ready; });
    await page.evaluate(() => window.__estellaHeadless.api.setCpuProfiling(true));
    const tiledLoad = await page.evaluate(() => window.__estellaHeadless.api.loadScene('/scenes/planar-tiled-lights.esscene'));
    assert.deepEqual(tiledLoad.missing, []);
    const lightDifference = (a,b) => changed(a,b,0,3);
    const distant = async enabled => {
      for (let id=100;id<116;id++) await field(id,'Light','enabled',enabled);
      await step(3);
    };
    await distant(false);
    const directLight = await capture('direct-light-reference');
    assert.ok(pixel(directLight,200,210)[0]>80,'the reference source must be lit');
    assert.ok(pixel(directLight,200,290)[0]>80,'the reference reflection must be lit');
    await distant(true);
    const tiledLight = await capture('tiled-light');
    const tiledCounters = await page.evaluate(() => window.__estellaHeadless.api.getCounters());
    assert.equal(tiledCounters['render.planar.tiledLights'],1,'the reflection must consume the additional light');
    assert.equal(lightDifference(directLight,tiledLight),0,'moving a light into the tiled list must preserve source and reflected illumination');
    await field(116,'Light','type',3);
    await field(116,'Light','innerAngle',60);
    await field(116,'Light','outerAngle',90);
    await step(3);
    const tiledSpot = await capture('tiled-spot');
    await distant(false);
    const directSpot = await capture('direct-spot');
    assert.ok(pixel(directSpot,200,290)[0]>80,'the reference spot reflection must be lit');
    assert.equal(lightDifference(directSpot,tiledSpot),0,'a spot must preserve its cone and reflected illumination in the tiled list');
    await field(116,'Light','type',0);
    await distant(true);
    await field(116,'Transform','position.x',1.3);
    await field(3,'Transform','position.x',1.3);
    await step(3);
    const tiledMoved = await capture('tiled-light-moved');
    await distant(false);
    const directMoved = await capture('direct-light-moved');
    assert.equal(lightDifference(directMoved,tiledMoved),0,'moving geometry and light must rebuild both views of the light grid');
    assert.ok(changed(directLight,tiledMoved,256)>100,'the reflected light must move with the object');
    await field(1,'Camera','viewport',{x:0,y:0,z:0.5,w:1});
    await field(6,'Camera','isActive',true); await step(3);
    const directSplit = await capture('direct-light-two-cameras');
    await distant(true);
    const tiledSplit = await capture('tiled-light-two-cameras');
    assert.equal(lightDifference(directSplit,tiledSplit),0,'each split-screen camera must restore its own light grid after its reflection');
    assert.deepEqual(errors,[]);
    report.checks.push({backend,ready,drawsOn,drawsOff,prepassDraws,reflectionPixels:changed(on,off,256),movingPixels:changed(on,moved,256),recovery,secondView,lossLogs,errors,
      tiledLights:{count:tiledCounters['render.planar.tiledLights'],pixelRgbSumTolerance:3,source:pixel(tiledLight,200,210),reflection:pixel(tiledLight,200,290),singleViewPixels:lightDifference(directLight,tiledLight),spotPixels:lightDifference(directSpot,tiledSpot),movedPixels:lightDifference(directMoved,tiledMoved),splitViewPixels:lightDifference(directSplit,tiledSplit)}});
    await page.close();
  }
  report.status = 'checks-passed';
  delete report.activeBackend;
  console.log(JSON.stringify(report));
} catch (error) { report.error = String(error); throw error; }
finally {
  await writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));
  await browser.close(); await new Promise(resolve=>server.close(resolve));
}
