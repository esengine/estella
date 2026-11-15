// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { runElectron } from './lib/electronRun.mjs';
import { readPNG } from './lib/png.mjs';
import { ROOT as root } from './lib/repo.mjs';

if (!process.env.CI) throw Error('Editor acceptance runs only in CI; do not launch the local editor.');
const out = path.join(root, 'output/gizmo-occlusion-ci');
fs.mkdirSync(out, { recursive: true });
const project = fs.mkdtempSync(path.join(out, 'project-'));
fs.mkdirSync(path.join(project, 'assets/scenes'), { recursive: true });
fs.mkdirSync(path.join(project, 'src'));
fs.writeFileSync(path.join(project, 'project.esproject'), JSON.stringify({
  formatVersion: '1', name: 'Handle depth acceptance', defaultScene: 'assets/scenes/main.esscene', spineVersion: 'none',
}));
fs.writeFileSync(path.join(project, 'assets/scenes/main.esscene'), JSON.stringify({
  version: '1.0', name: 'Main', entities: [
    { id: 1, name: 'Pivot inside blocker', parent: null, children: [], visible: true,
      components: [{ type: 'Transform', data: { position: { x: 0, y: 0, z: 0 } } }] },
    { id: 2, name: 'Opaque blocker', parent: null, children: [], visible: true, components: [
      { type: 'Transform', data: { position: { x: 0, y: 0, z: 0 }, scale: { x: 2, y: 2, z: 2 } } },
      { type: 'MeshRenderer', data: { mesh: 'builtin:cube', lit: false, opaque: true,
        color: { r: 0.4, g: 0.4, b: 0.4, a: 1 } } },
    ] },
  ],
}));
for (const name of ['main', 'components']) fs.writeFileSync(path.join(project, 'src', name + '.ts'), 'export {};');
const records = [];
try {
  for (const blocked of [true, false]) for (const fade of [false, true]) {
    const name = `${blocked ? 'blocked' : 'clear'}-${fade ? 'fade' : 'solid'}`;
    const run = runElectron(['.'], { via: 'npx', encoding: 'utf8', cwd: path.join(root, 'desktop'), timeout: 180000, env: {
      ESTELLA_SHOT: path.join(out, name + '.png'), ESTELLA_SHOT_PROJECT: project,
      ESTELLA_SHOT_SCENE: 'assets/scenes/main.esscene',
      ESTELLA_SHOT_EVAL: `(async()=>{
        const e=window.__estellaEditor,wait=ms=>new Promise(r=>setTimeout(r,ms));
        const find=async s=>{for(let i=0;i<50;i++){const n=document.querySelector(s);if(n)return n;await wait(100);}throw Error('Missing '+s);};
        e.runCommand('settings.open');const search=await find('.set-search input');
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(search,'viewport.gizmoOcclusion');
        search.dispatchEvent(new Event('input',{bubbles:true}));await wait(200);
        if(document.querySelectorAll('.set-content .set-row').length!==1)throw Error('Occlusion setting is not unique');
        const toggle=await find('.set-content [role="switch"]');
        toggle.click();await wait(100);
        if((toggle.getAttribute('aria-checked')==='true')!==${fade})toggle.click();await wait(100);
        const saved=JSON.parse(localStorage.getItem('estella.settings')||'{}')['viewport.gizmoOcclusion'];
        if(saved!==${fade})throw Error('Occlusion preference was not saved');
        document.querySelector('.set-win').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));await wait(300);
        e.runCommand('mode.scene');e.surface.setViewPerspective(true);e.surface.setViewOrbit(45,30);
        e.surface.select(2);e.frame([2]);await wait(750);
        ${blocked ? '' : "e.surface.setField(2,'Transform','position','vec3',{x:10000,y:10000,z:10000});"}
        e.surface.select(1);e.runCommand('tool.rotate');await wait(300);
        const g=e.gizmoLayout(),r=document.querySelector('.viewport__stage canvas').getBoundingClientRect();
        if(!g?.spatial)throw Error('Missing spatial handles');
        return {layout:g,rect:{x:r.x,y:r.y},dpr:window.devicePixelRatio,saved,view:e.editorView(),
          blocker:e.surface.serializeScene().entities.find(v=>v.id===2)};
      })()`,
    } });
    fs.writeFileSync(path.join(out, name + '.log'), run.stdout + '\n' + run.stderr);
    assert.equal(run.status, 0, run.stderr);
    const line = run.stdout.split('\n').find(s => s.startsWith('[eval] '));
    assert(line, 'Missing occlusion observation: ' + name);
    const observation = JSON.parse(line.slice(7));
    const image = readPNG(fs.readFileSync(path.join(out, name + '.png')));
    const { layout, rect, dpr } = observation;
    const radius = layout.rings.find(r => r.axis === 'view')?.radius;
    assert(radius > 0, 'Missing screen ring');
    const pixels = [];
    // Sample the outer ring away from inner-ring intersections and the mouse.
    for (const angle of [0.35, 1.15, 2.1, 2.8, 3.6, 4.3, 5.1, 5.8]) {
      const x = (rect.x + layout.screen.x + radius * Math.cos(angle)) * dpr;
      const y = (rect.y + layout.screen.y + radius * Math.sin(angle)) * dpr;
      let strongest = [0, 0, 0], score = -Infinity;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const p = image.px(Math.round(x) + dx, Math.round(y) + dy);
        if (p[2] - p[0] > score) { strongest = p; score = p[2] - p[0]; }
      }
      pixels.push(strongest);
    }
    records.push({ name, ...observation, pixels });
    fs.writeFileSync(path.join(out, 'observations.json'), JSON.stringify(records, null, 2));
  }
  const score = name => records.find(r => r.name === name).pixels.reduce((n, p) => n + p[2] - p[0], 0) / 8;
  assert(score('blocked-solid') > 70, 'Solid handles are missing behind the blocker');
  assert(score('blocked-fade') > 5, 'Occluded handles disappeared instead of fading');
  assert(score('blocked-fade') < score('blocked-solid') * 0.65, 'The blocker did not fade the spatial ring');
  assert(score('clear-fade') > 70, 'Unoccluded handles are missing');
  assert(Math.abs(score('clear-fade') - score('clear-solid')) < 12, 'Unoccluded handles changed opacity');
  fs.writeFileSync(path.join(out, 'checks.json'), JSON.stringify({ status: 'checks-passed', records }, null, 2));
  console.log('Spatial handles fade behind opaque geometry; visible handles and the setting override retain full ink.');
} finally {
  if (!project.startsWith(out + path.sep)) throw Error('Unexpected cleanup path');
  fs.rmSync(project, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
}
