// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  editor-capabilities-e2e.mjs — a capability does on a real editor what
 *        its unit tests say it dispatches.
 *
 *        The unit tests drive a fake driver: they prove a capability calls the
 *        tools it means to, in order, and inherits their gates. What they cannot
 *        prove is that those calls do the intended thing to a scene — that
 *        `RigidBody.bodyType` is a field that exists, that an enum arrives as a
 *        name and lands as the right member, that a subtree built by one step is
 *        addressable by the next. Every bug this repo has had in the automation
 *        surface was of that shape: the call succeeded and the scene disagreed.
 *
 *        Run from desktop/:  node scripts/editor-capabilities-e2e.mjs
 */
import { cp, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withEditor, checker } from './lib/editorDriver.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXAMPLE = path.resolve(HERE, '..', '..', 'examples', 'space-shooter');

// A throwaway copy: these capabilities write prefabs and scripts into the
// project, and an e2e that dirties a shipped example is one nobody reruns.
const tmpRoot = await mkdtemp(path.join(os.tmpdir(), 'estella-cap-e2e-'));
const project = path.join(tmpRoot, 'game');
await cp(EXAMPLE, project, {
  recursive: true,
  filter: (src) => !/[/\\](\.esengine|node_modules|dist)([/\\]|$)/.test(src),
});

const json = (reply) => {
  const text = reply?.text ?? reply;
  try { return JSON.parse(text); } catch { return text; }
};

const failures = await withEditor(async (ed) => {
  const check = checker();

  const tools = (await ed.rpc('tools/list', {}, 30000)).result?.tools ?? [];
  const names = tools.map((t) => t.name);
  for (const cap of ['create_hud_text', 'playtest', 'create_prefab', 'configure_physics_body',
    'wire_ui_event', 'create_behavior']) {
    check(names.includes(cap), `tools/list is missing the capability ${cap}`);
  }
  console.log(`tools/list OK — ${names.length} entries, capabilities among them`);

  await ed.call('open_project', { root: project }, 180_000);
  console.log('open_project OK');

  // — configure_physics_body: two components and their fields, from one call —
  const built = json(await ed.call('apply_scene_ops', {
    ops: [{ op: 'create', ref: 'body', name: 'CapBody', components: ['Transform'], x: 0, y: 0 }],
  }, 30000));
  const entity = built?.refs?.body;
  check(typeof entity === 'number', `apply_scene_ops gave no entity: ${JSON.stringify(built)}`);

  const physics = json(await ed.call('configure_physics_body', {
    entity, body: 'kinematic', shape: 'circle', size: 2.5, sensor: true, gravityScale: 0,
  }, 30000));
  check(physics?.collider === 'CircleCollider', `configure_physics_body: ${JSON.stringify(physics)}`);

  const after = json(await ed.call('get_inspector', { entity }, 30000));
  const components = new Map((after?.components ?? []).map((c) => [c.type, c]));
  check(components.has('RigidBody'), 'configure_physics_body left no RigidBody');
  check(components.has('CircleCollider'), 'configure_physics_body left no CircleCollider');

  const field = (type, key) => (components.get(type)?.fields ?? []).find((f) => f.key === key)?.value;
  // The enum went over as the NAME "kinematic"; what matters is the member it landed on.
  check(String(field('RigidBody', 'bodyType')).toLowerCase().includes('kinematic')
    || field('RigidBody', 'bodyType') === 1,
  `bodyType did not become kinematic: ${JSON.stringify(field('RigidBody', 'bodyType'))}`);
  check(field('RigidBody', 'gravityScale') === 0, `gravityScale: ${field('RigidBody', 'gravityScale')}`);
  check(field('CircleCollider', 'radius') === 2.5, `radius: ${field('CircleCollider', 'radius')}`);
  check(field('CircleCollider', 'isSensor') === true, `isSensor: ${field('CircleCollider', 'isSensor')}`);
  console.log('configure_physics_body OK — RigidBody + CircleCollider, fields as asked');

  // Idempotent: running it again must not add a second RigidBody.
  await ed.call('configure_physics_body', { entity, body: 'dynamic' }, 30000);
  const twice = json(await ed.call('get_inspector', { entity }, 30000));
  const bodies = (twice?.components ?? []).filter((c) => c.type === 'RigidBody').length;
  check(bodies === 1, `running it twice left ${bodies} RigidBody components`);
  console.log('configure_physics_body OK — repeatable, still one body');

  // — create_prefab: subtree in, reusable asset out —
  const prefab = json(await ed.call('create_prefab', {
    name: 'CapCoin',
    replace: true,
    ops: [
      { op: 'create', ref: 'root', name: 'temp', components: ['Transform'] },
      { op: 'create', ref: 'child', name: 'Face', parent: '$root', components: ['Transform'] },
    ],
  }, 60000));
  check(typeof prefab?.entity === 'number', `create_prefab gave no entity: ${JSON.stringify(prefab)}`);
  check(String(prefab?.prefab ?? '').startsWith('@uuid:'), `create_prefab gave no uuid ref: ${JSON.stringify(prefab)}`);

  const templates = json(await ed.call('list_entity_templates', {}, 30000));
  const ids = (Array.isArray(templates) ? templates : templates?.templates ?? []).map((t) => t.id ?? t);
  check(ids.includes(prefab.template), `the extracted prefab is not offered as ${prefab.template}`);
  console.log(`create_prefab OK — ${prefab.template} is instantiable`);

  // — wire_ui_event: adds rather than replaces —
  const wired1 = json(await ed.call('wire_ui_event', {
    entity, event: 'click', action: 'ui.setVisible', params: { visible: false },
  }, 30000));
  check(wired1?.rows === 1, `first wire: ${JSON.stringify(wired1)}`);
  const wired2 = json(await ed.call('wire_ui_event', { entity, event: 'click', action: 'fsm.fire' }, 30000));
  check(wired2?.rows === 2, `second wire did not ADD to the first: ${JSON.stringify(wired2)}`);
  const rows = json(await ed.call('get_event_bindings', { entity }, 30000));
  check(Array.isArray(rows) && rows.length === 2, `bindings read back: ${JSON.stringify(rows)}`);
  console.log('wire_ui_event OK — two wires, neither dropped');

  // — create_hud_text: on the SCREEN, anchored, and not in the world —
  const hud = json(await ed.call('create_hud_text', {
    text: 'SCORE 0', at: 'top-left', margin: 16, fontSize: 28, color: '#ffcc00ff',
  }, 60000));
  check(typeof hud?.entity === 'number', `create_hud_text gave no entity: ${JSON.stringify(hud)}`);
  check(typeof hud?.canvas === 'number', `create_hud_text found/made no canvas: ${JSON.stringify(hud)}`);

  const label = json(await ed.call('get_inspector', { entity: hud.entity }, 30000));
  const lc = new Map((label?.components ?? []).map((c) => [c.type, c]));
  check(lc.has('UINode') && lc.has('Text'), `the label is not a UI text: ${[...lc.keys()]}`);
  const lf = (type, key) => (lc.get(type)?.fields ?? []).find((f) => f.key === key)?.value;
  check(String(lf('Text', 'content')) === 'SCORE 0', `content: ${JSON.stringify(lf('Text', 'content'))}`);
  // Absolute, or the insets below are decoration.
  check(String(lf('UINode', 'position')).toLowerCase().includes('absolute') || lf('UINode', 'position') === 1,
    `position did not become Absolute: ${JSON.stringify(lf('UINode', 'position'))}`);
  // The trap this exists for: a dimension left Auto IGNORES its number.
  const inset = lf('UINode', 'insetTop');
  const insetValue = typeof inset === 'object' && inset ? inset.value : inset;
  const insetUnit = typeof inset === 'object' && inset ? inset.unit : undefined;
  check(insetValue === 16, `insetTop.value: ${JSON.stringify(inset)}`);
  check(insetUnit !== 2, `insetTop stayed Auto, so its 16 does nothing: ${JSON.stringify(inset)}`);
  // And no warning, because nothing wrote a layout-owned field.
  check(!hud.warnings, `create_hud_text tripped a layout warning: ${JSON.stringify(hud.warnings)}`);
  console.log('create_hud_text OK — anchored UI text, insets in px, no layout-owned write');

  // A second one reuses the canvas the first made rather than stacking another.
  const hud2 = json(await ed.call('create_hud_text', { text: 'LIVES 3', at: 'top-right' }, 60000));
  check(hud2?.canvas === hud.canvas, `the second label made its own canvas: ${hud2?.canvas} vs ${hud.canvas}`);
  check(hud2?.createdCanvas === false, 'the second label reports creating a canvas');
  console.log('create_hud_text OK — one canvas, both labels under it');

  // — playtest: run it and come back with a picture —
  const played = json(await ed.call('playtest', { frames: 10, cols: 24, probe: '1 + 1' }, 120000));
  check(played?.enteredPlay === true, `playtest did not enter play: ${JSON.stringify(played?.enteredPlay)}`);
  check(String(played?.probe ?? '').includes('2'), `probe did not evaluate: ${JSON.stringify(played?.probe)}`);
  check(typeof played?.picture === 'string' && played.picture.length > 20,
    `playtest brought back no text picture: ${JSON.stringify(played?.picture)?.slice(0, 120)}`);
  console.log(`playtest OK — entered play, probed, ${String(played.picture).length} chars of picture`);
  await ed.call('toggle_play', {}, 60000);

  // A capability's failure names the step, not just the message.
  const bad = await ed.call('configure_physics_body', { entity: 999999, body: 'dynamic' }, 30000).catch((e) => ({ text: String(e) }));
  check(/step /.test(String(bad?.text ?? '')), `a failing capability did not name its step: ${JSON.stringify(bad)}`);
  console.log('capability failures name their step');

  return check.failures;
});

await rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
process.exit(failures > 0 ? 1 : 0);
