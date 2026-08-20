// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  gizmo-chrome — a gizmo that computes a shape draws it.
 *
 * A light's reach circle, its aim, a spot's cone and its radius handle were all
 * computed every frame into an `<svg>` sized to nothing, and none of them had ever
 * appeared. Nobody noticed because the bulb icon beside them did: a gizmo that draws
 * ANY ink looks present, so "it drew something" is not the claim worth making.
 *
 * The claim is reach. A Marker is the one entity here whose gizmo is only an icon,
 * so it measures what an icon alone covers; every other class draws a shape around
 * its entity and must reach well past that. One editor, each component in turn.
 */
import { cp } from 'node:fs/promises';
import path from 'node:path';
import { makeProject, checker, originIn, viewportRegion, DESKTOP } from '../lib/editorDriver.mjs';

const EXAMPLE = path.resolve(DESKTOP, '..', 'examples', 'sprite-rendering');

/** One entity at the origin, which is where the view's focus is. */
const SCENE = JSON.stringify({
  version: '1.0', name: 'Main',
  entities: [
    {
      id: 0, name: 'Subject', parent: null, children: [], visible: true,
      components: [{ type: 'Transform', data: { position: { x: 0, y: 0, z: 0 } } }],
    },
  ],
}, null, 1);

export const name = 'gizmo-chrome';
export const describes = 'every gizmo that computes a shape actually draws it';

/** The ink the gizmo toggle adds around `c`, and how far it reaches. */
function ink(a, b, c, limit, tol = 25) {
  let far = 0;
  let n = 0;
  const x1 = Math.min(Math.min(a.w, b.w), c.x + limit);
  const y1 = Math.min(Math.min(a.h, b.h), c.y + limit);
  for (let y = Math.max(0, c.y - limit); y < y1; y++) {
    for (let x = Math.max(0, c.x - limit); x < x1; x++) {
      const p = a.px(x, y);
      const q = b.px(x, y);
      if (Math.abs(p[0] - q[0]) > tol || Math.abs(p[1] - q[1]) > tol || Math.abs(p[2] - q[2]) > tol) {
        n += 1;
        far = Math.max(far, Math.hypot(x - c.x, y - c.y));
      }
    }
  }
  return { n, far };
}

/** The icon-only case, measured rather than assumed — it sets the bar for the rest. */
const ICON_ONLY = { comp: 'Marker', fields: [] };

/** Each of these draws a shape around its entity, sized well past an icon. */
const SHAPED = [
  { comp: 'Camera', fields: [], draws: 'the rect it frames' },
  {
    comp: 'Light2D',
    fields: [['type', 'number', 0], ['radius', 'number', 220], ['intensity', 'number', 1]],
    draws: 'its reach circle',
  },
  {
    comp: 'ParticleEmitter',
    fields: [['shape', 'number', 1], ['shapeRadius', 'number', 200]],
    draws: 'its spawn disk',
  },
  { comp: 'BoxCollider', fields: [['halfExtents', 'vec2', [2, 2]]], draws: 'its collider outline' },
  { comp: 'BoxCollider3D', fields: [['halfExtents', 'vec3', [80, 80, 80]]], draws: 'its wireframe' },
];

export async function run(ed) {
  const root = await makeProject({ 'assets/scenes/main.esscene': SCENE });
  await cp(path.join(EXAMPLE, 'project.esproject'), path.join(root, 'project.esproject'));
  await cp(path.join(EXAMPLE, 'src'), path.join(root, 'src'), { recursive: true });
  const check = checker();
  await ed.open(root, 'assets/scenes/main.esscene');
  // The design overlay belongs to UI mode, and the editor remembers its mode.
  await ed.call('run_editor_command', { id: 'mode.scene' }, 30000);
  await ed.call('select', { id: null }, 30000);
  await ed.sleep(800);

  const first = await ed.screenshot('gizmo-chrome-locate');
  const origin = originIn(first, viewportRegion(first));
  if (!check(origin != null, "the grid's axis lines were not found — the subject is at the origin")) {
    return check.failures;
  }

  /** Add a component, measure what its gizmo paints, take it off again. */
  const measure = async (c) => {
    await ed.call('add_component', { entity: 0, component: c.comp }, 30000);
    for (const [key, type, value] of c.fields) {
      await ed.call('set_field', { entity: 0, component: c.comp, key, type, value }, 30000);
    }
    // Adding a component selects its entity, and a selection draws chrome of its own.
    await ed.call('select', { id: null }, 30000);
    await ed.sleep(700);
    await ed.call('run_editor_command', { id: 'view.toggleGizmos' }, 30000);
    await ed.sleep(700);
    const off = await ed.screenshot(`gizmo-chrome-${c.comp}-off`);
    await ed.call('run_editor_command', { id: 'view.toggleGizmos' }, 30000);
    await ed.sleep(700);
    const on = await ed.screenshot(`gizmo-chrome-${c.comp}-on`);
    const m = ink(off, on, origin, 300);
    await ed.call('remove_component', { entity: 0, component: c.comp }, 30000);
    await ed.sleep(400);
    return m;
  };

  const icon = await measure(ICON_ONLY);
  if (!check(icon.n > 20 && icon.far > 2,
      `${ICON_ONLY.comp} painted ${icon.n} pixels reaching ${icon.far.toFixed(0)}px — its own icon `
      + 'is not being drawn, so there is nothing to measure the others against')) {
    return check.failures;
  }

  for (const c of SHAPED) {
    const m = await measure(c);
    check(
      m.far > icon.far * 3,
      `${c.comp} paints ${m.n} pixels reaching ${m.far.toFixed(0)}px, against ${icon.far.toFixed(0)}px `
      + `for an icon alone — ${c.draws} is computed and not drawn`,
    );
  }

  return check.failures;
}
