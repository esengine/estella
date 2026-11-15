// SPDX-License-Identifier: Apache-2.0
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { runElectron } from './lib/electronRun.mjs';
import { ROOT as root } from './lib/repo.mjs';
if (!process.env.CI) throw Error('Editor acceptance runs only in CI. Do not launch the local editor.');
const out = path.join(root, 'output/navigation-inspector-ci');
fs.mkdirSync(out, { recursive: true });
const records = [];
for (const state of ['complete', 'disconnected', 'insufficient-clearance', 'no-target', 'building']) {
  const project = fs.mkdtempSync(path.join(out, 'project-'));
  fs.mkdirSync(path.join(project, 'assets/scenes'), { recursive: true });
  fs.mkdirSync(path.join(project, 'src'));
  fs.writeFileSync(path.join(project, 'project.esproject'), JSON.stringify({ formatVersion: '1', name: 'Navigation inspector acceptance', defaultScene: 'assets/scenes/main.esscene', spineVersion: 'none' }));
  fs.writeFileSync(path.join(project, 'assets/scenes/main.esscene'), JSON.stringify({ version: '1.0', name: 'Main', entities: [
    { id: 1, name: 'Route subject', parent: null, children: [], components: [
      { type: 'Transform', data: { position: { x: 2, y: 4, z: 0 } } },
      { type: 'NavAgent', data: { hasTarget: state !== 'no-target', targetX: 8, targetY: 4, targetZ: 0, radius: state === 'insufficient-clearance' ? 2 : 0 } },
    ] },
  ] }));
  fs.writeFileSync(path.join(project, 'src/components.ts'), "export { NavAgent } from 'esengine/ai';");
  fs.writeFileSync(path.join(project, 'src/main.ts'), `
import { addPlugin } from 'esengine';
import { Nav, Navigation, NavGrid } from 'esengine/ai';
addPlugin({name:'navigation-inspection-fixture',build(app){
  const nav=new Navigation(),grid=new NavGrid({width:11,height:9,cellSize:1});
  ${state === 'disconnected' || state === 'insufficient-clearance' ? `for(let y=0;y<9;y++) if(${state === 'insufficient-clearance' ? 'y!==4' : 'true'}) grid.setWalkable(5,y,false);` : ''}
  nav.setSurface(grid);${state === 'building' ? 'nav.beginSurfaceUpdate();' : ''}app.insertResource(Nav,nav);
}});`);
  const script = `(async()=>{
    const e=window.__estellaEditor;
    e.surface.select(1);
    const wait=async(f)=>{for(let i=0;i<300;i++){const v=f();if(v)return v;await new Promise(r=>setTimeout(r,20));}throw Error('Navigation inspector did not settle');};
    const head=await wait(()=>[...document.querySelectorAll('.comp-head')].find(h=>h.textContent.includes('Nav')));
    if(!document.querySelector('.nav-diagnostic'))head.click();
    const panel=await wait(()=>document.querySelector('.nav-diagnostic'));
    const button=panel.querySelector('button');
    if(button.disabled)throw Error('Route inspection disabled in ready Play');
    if(panel.querySelector('[role=status]').textContent.trim())throw Error('Route queried without clicking');
    button.click();
    await wait(()=>!button.disabled&&panel.querySelector('[role=status]').textContent.trim());
    return {state:${JSON.stringify(state)},text:panel.textContent,status:panel.querySelector('[role=status]').textContent};
  })()`;
  const run = runElectron(['.'], { via: 'npx', encoding: 'utf8', cwd: path.join(root, 'desktop'), timeout: 180000, env: {
    ESTELLA_SHOT: path.join(out, state + '.png'), ESTELLA_SHOT_PROJECT: project,
    ESTELLA_SHOT_SCENE: 'assets/scenes/main.esscene', ESTELLA_SHOT_PLAY: '1',
    ESTELLA_SHOT_LOCALE: 'en', ESTELLA_SHOT_EVAL: script,
  } });
  fs.writeFileSync(path.join(out, state + '.log'), run.stdout + '\n' + run.stderr);
  assert.equal(run.status, 0, run.stderr);
  const line = run.stdout.split('\n').find(line => line.startsWith('[eval] '));
  assert(line, 'Missing inspector observation');
  const result = JSON.parse(line.slice('[eval] '.length));
  const expected = { complete: 'Route reaches the resolved destination', disconnected: 'Start and target are disconnected', 'insufficient-clearance': 'this agent cannot fit', 'no-target': 'No active destination', building: 'Navigation is updating' }[state];
  assert(result.status.includes(expected), JSON.stringify(result));
  if (state !== 'no-target') assert(result.status.includes('Last planning tick:'), 'Missing live planning queue counters');
  assert(fs.existsSync(path.join(out, state + '.png')), 'Missing editor screenshot');
  records.push(result);
  fs.writeFileSync(path.join(out, 'observations.json'), JSON.stringify({ records }, null, 2));
}
console.log('Navigation inspector: 5 live Play scenarios passed.');
