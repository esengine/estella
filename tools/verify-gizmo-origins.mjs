// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { runElectron } from './lib/electronRun.mjs';
if (!process.env.CI) throw Error('Editor acceptance runs only in CI. Do not launch the local editor.');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'output/gizmo-origins-ci');
fs.mkdirSync(out, { recursive: true });
const project = fs.mkdtempSync(path.join(out, 'project-'));
fs.mkdirSync(path.join(project, 'assets/scenes'), { recursive: true });
fs.mkdirSync(path.join(project, 'src'));
fs.writeFileSync(path.join(project, 'project.esproject'), JSON.stringify({
  formatVersion: '1', name: 'Individual origins acceptance', defaultScene: 'assets/scenes/main.esscene', spineVersion: 'none',
}));
fs.writeFileSync(path.join(project, 'assets/scenes/main.esscene'), JSON.stringify({
  version: '1.0', name: 'Main', entities: [1, 2].map(id => ({
    id, name: 'Sprite ' + id, parent: null, children: [], visible: true, components: [
      { type: 'Transform', data: { position: { x: id === 1 ? -100 : 100, y: 0, z: 0 } } },
      { type: 'Sprite', data: { size: { x: 60, y: 60 }, color: { r: 1, g: 0, b: 1, a: 1 } } },
    ],
  })),
}));
fs.writeFileSync(path.join(project, 'src/main.ts'), 'export {};');
fs.writeFileSync(path.join(project, 'src/components.ts'), 'export {};');
// Capture the actual gesture, then check that one undo restores all its targets.
// PNGs show the restored scene after undo or Escape, rather than the changed pose.
const read = `(() => {
  const e=window.__estellaEditor;
  const snapshot=()=>e.surface.serializeScene().entities.map(entity=>{
    const t=entity.components.find(c=>c.type==='Transform').data;
    return {id:entity.id,position:t.position??{x:0,y:0,z:0},rotation:t.rotation??{x:0,y:0,z:0,w:1},scale:t.scale??{x:1,y:1,z:1}};
  });
  const scene=snapshot();
  if(!window.__originsRead){window.__originsRead=true;return {scene};}
  e.surface.undo();return {scene,undone:snapshot()};
})()`;
const near = (a, b) => assert(Math.abs(a - b) < 1e-4, `${a} differs from ${b}`);
const records = [];
try {
  // Where a drag starts is where the handle IS, in CSS px from the pivot: the rotate ring's radius, the end of the
  // scale arrow, the end of the universal tool's separate scale arrow — GIZMO in desktop/src/tools/gizmo.ts.
  // All at gizmoSize 1.2, the store's default: at the bare constants a drag starts inside the ring and marquee-selects instead.
  const RING = 79, SCALE_ARROW = 96, UNIVERSAL_SCALE = 120, MOVE_SHAFT = 60, UNIVERSAL_SHAFT = 50, UNIVERSAL_RING = 56;
  const cases = [
    ...['center', 'individual'].flatMap(pivot => [
      { pivot, mode: 'rotate', ox: RING, dx: -RING, dy: -RING },
      { pivot, mode: 'scale', ox: SCALE_ARROW, dx: SCALE_ARROW, dy: 0 },
      { pivot, mode: 'move', ox: MOVE_SHAFT, dx: 25, dy: 0 },
    ]),
    { pivot: 'individual', mode: 'scale', ox: SCALE_ARROW, dx: SCALE_ARROW, dy: 0, cancel: true },
    { pivot: 'individual', mode: 'rotate', ox: RING, dx: -RING, dy: -RING, alt: true },
    { pivot: 'individual', tool: 'universal', mode: 'move', ox: UNIVERSAL_SHAFT, dx: 25, dy: 0 },
    { pivot: 'individual', tool: 'universal', mode: 'scale', ox: UNIVERSAL_SCALE, dx: UNIVERSAL_SCALE, dy: 0 },
    { pivot: 'individual', tool: 'universal', mode: 'rotate', ox: UNIVERSAL_RING, oy: -UNIVERSAL_RING, dx: -90, dy: 0 },
    { pivot: 'individual', tool: 'universal', mode: 'scale', ox: UNIVERSAL_SCALE, dx: UNIVERSAL_SCALE, dy: 0, cancel: true },
    { pivot: 'individual', tool: 'universal', mode: 'rotate', ox: UNIVERSAL_RING, oy: -UNIVERSAL_RING, dx: -90, dy: 0, alt: true },
  ];
  for (const c of cases) {
    const name = `${c.tool === 'universal' ? 'universal-' : ''}${c.pivot}-${c.mode}${c.cancel ? '-escape' : c.alt ? '-duplicate' : ''}`;
    const run = runElectron(['.'], { via: 'npx', encoding: 'utf8', cwd: path.join(root, 'desktop'), timeout: 180000, env: {
      ESTELLA_SHOT: path.join(out, name + '.png'), ESTELLA_SHOT_PROJECT: project,
      ESTELLA_SHOT_SCENE: 'assets/scenes/main.esscene',
      ESTELLA_SHOT_EVAL: `(async()=>{const e=window.__estellaEditor;e.runCommand('mode.scene');e.runCommand('view.resetOrbit');e.runCommand('view.pivot${c.pivot === 'individual' ? 'Individual' : 'Center'}');e.surface.selectMany([1,2],1);e.frame([1,2]);await new Promise(r=>setTimeout(r,750));e.runCommand('tool.${c.tool ?? c.mode}');return true;})()`,
      ESTELLA_SHOT_EDITOR_DRAG: JSON.stringify({ selector: '.viewport__stage canvas', ...c, read }),
    } });
    assert.equal(run.status, 0, run.stderr);
    const line = run.stdout.split('\n').find(line => line.startsWith('[editorDrag] '));
    assert(line, 'No trusted drag observation');
    const result = JSON.parse(line.slice('[editorDrag] '.length));
    records.push({ name, ...result });
    fs.writeFileSync(path.join(out, 'observations.json'), JSON.stringify({ status: 'checking', records }, null, 2));
    const before = result.before.scene, after = result.after.scene;
    assert.deepEqual(result.after.undone, before, 'A single undo did not restore all targets');
    if (c.cancel) assert.deepEqual(after, before, 'Escape failed to restore the transaction');
    else {
      assert.notDeepEqual(after, before, 'Gesture did not change the scene: ' + name);
      if (c.alt) {
        assert.equal(after.length, 4, 'Alt did not duplicate the selection');
        for (const initial of before) assert.deepEqual(after.find(t=>t.id===initial.id), initial, 'Alt modified an original');
      }
      for (const t of c.alt ? after.filter(t => !before.some(b => b.id === t.id)) : after) {
        const initial = c.alt ? before.find(b => b.position.x === t.position.x) : before.find(b => b.id === t.id);
        assert(initial, 'Missing starting target');
        if (c.mode === 'move') assert.notDeepEqual(t.position, initial.position);
        else if (c.pivot === 'individual') assert.deepEqual(t.position, initial.position, 'Individual origin moved');
        else assert.notDeepEqual(t.position, initial.position, 'Shared center did not move target');
        if (c.mode === 'rotate') assert.notDeepEqual(t.rotation, initial.rotation);
        else assert.deepEqual(t.rotation, initial.rotation, 'Gesture also rotated the target');
        if (c.mode !== 'scale') assert.deepEqual(t.scale, initial.scale, 'Gesture also scaled the target');
        if (c.mode === 'scale') { near(t.scale.x, 2); near(t.scale.y, 1); near(t.scale.z, 1); }
      }
    }
    assert(fs.existsSync(path.join(out, name + '.png')), 'Missing restored-scene PNG');
  }
  assert.deepEqual(records.find(r=>r.name==='individual-move').after.scene,
    records.find(r=>r.name==='center-move').after.scene, 'Translation changed with the pivot policy');
  fs.writeFileSync(path.join(out, 'checks.json'), JSON.stringify({ status: 'checks-passed', records }, null, 2));
  console.log('Individual Origins CI: rotate/scale/move, one-step undo, Escape and Alt duplication pass');
} finally {
  if (!project.startsWith(out + path.sep)) throw Error('Unexpected cleanup directory');
  fs.rmSync(project, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
}
