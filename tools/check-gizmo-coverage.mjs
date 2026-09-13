// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  check-gizmo-coverage.mjs — a component that describes a SPACE is drawn.
 *
 * `gizmo-chrome` proves that the gizmos it lists paint something. What it cannot
 * do is notice a new component: its list is written by hand, so a component added
 * with a radius or a box on it is invisible in the editor AND invisible to the
 * gate — which is how a NavVolume shipped with a number nobody could see the
 * extent of.
 *
 * That is why this file does NOT hold a list of spatial field names. It held one
 * for a while, and the list is the same failure one level up: `loadRadius`,
 * `prefetchRadius`, `unloadRadius` and `cellSize` arrived with world streaming,
 * none of them was in the enum, so the newest feature in the engine was never
 * judged at all while this gate reported every component green.
 *
 * So the rule is inverted. DISCOVERY is broad and structural — an authored,
 * numeric field whose name carries a length word. Every pair it finds must then
 * carry a DISPOSITION saying what the number is:
 *
 *   extent     a region of world nothing renders — the viewport must name the
 *              component, which is where a gizmo's geometry is computed
 *   renders    a world length whose own drawing IS the picture (a sprite's size)
 *   no-place   a world length that limits or parameterises something else and
 *              has no region of its own (a step height, a contact skin)
 *   not-world  not measured in world space at all (type metrics, a screen
 *              fraction, a texture's pixel size)
 *   owed       an extent nothing draws. Debt, recorded as debt — never a reason
 *
 * A pair with no disposition FAILS. That is the whole point: the next component
 * with a number in it cannot be quietly skipped because nobody thought to add
 * its field name anywhere. It has to be answered.
 *
 * Granularity note: a disposition is per FIELD, the drawn check is per COMPONENT
 * (textually, the viewport naming it at all). A component that draws one of its
 * extents and forgets another still passes here — that is gizmo-chrome's
 * question. This one is about not forgetting a component entirely.
 */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SNAPSHOT = path.join(ROOT, 'docs', 'astro', 'src', 'data', 'components.generated.json');
/** The one file where a gizmo's geometry is computed. */
const VIEWPORT = path.join(ROOT, 'desktop', 'src', 'engine', 'ViewportController.ts');

/** A name that carries any of these could be naming a length. Deliberately loose:
 *  a false positive costs one line of disposition, a false negative costs a
 *  feature nobody can see. */
const LENGTH_WORDS = /(radius|extent|bounds|size|width|height|depth|distance|range)/i;
/** Only a number can be a length; `Dimension`, `enum` and the curve objects cannot. */
const NUMERIC = /^(number|Vec2|Vec3|Vec4)$/;

/**
 * What every discovered field IS. Keyed `Component.field`, because the same name
 * means different things on different components: `cellSize` is a voxel on a
 * NavVolume, a tile on a TilemapLayer, and a streamed cell of world on a
 * StreamedWorld.
 */
const DISPOSITION = {
  // A region of world nothing renders — the viewport has to outline it.
  'BoxCollider2D.halfExtents': 'extent',
  'BoxCollider2D.radius': 'extent',
  'BoxCollider3D.halfExtents': 'extent',
  'CapsuleCollider2D.radius': 'extent',
  'CapsuleCollider2D.halfHeight': 'extent',
  'CapsuleCollider3D.radius': 'extent',
  'CapsuleCollider3D.halfHeight': 'extent',
  'CircleCollider2D.radius': 'extent',
  'PolygonCollider2D.radius': 'extent',
  'SphereCollider3D.radius': 'extent',
  'CharacterController3D.radius': 'extent',
  'CharacterController3D.halfHeight': 'extent',
  'Camera.orthoSize': 'extent',
  'Light.radius': 'extent',
  'Light.innerRadius': 'extent',
  'Light.cookieSize': 'extent',
  'MeleeAttack.radius': 'extent',
  'AudioSource.minDistance': 'extent',
  'AudioSource.maxDistance': 'extent',
  'NavAgent.radius': 'extent',
  'NavAgent.arriveRadius': 'extent',
  'NavArea.halfExtents': 'extent',
  'NavObstacle.halfExtents': 'extent',
  'NavLink.radius': 'extent',
  'NavVolume.halfExtents': 'extent',
  'ParticleForceField.radius': 'extent',
  'ParticleEmitter.shapeRadius': 'extent',
  'ParticleEmitter.shapeSize': 'extent',
  'PostProcessVolume.size': 'extent',
  'ShadowCaster2D.size': 'extent',
  'TilemapLayer.cellSize': 'extent',
  'StreamedWorld.cellSize': 'extent',
  'WorldStreamingSource.prefetchRadius': 'extent',
  'WorldStreamingSource.loadRadius': 'extent',
  'WorldStreamingSource.unloadRadius': 'extent',

  // The component's own drawing is the picture; an outline round it would trace
  // what is already on screen.
  'Sprite.size': ['renders', 'the sprite drawn at it is the outline'],
  'Sprite.tileSize': ['renders', 'the repeat of a drawn sprite'],
  'ShapeRenderer.size': ['renders', 'the shape drawn at it is the outline'],
  'ShapeRenderer.cornerRadius': ['renders', 'a corner of the shape it draws'],
  'UIVisual.tileSize': ['renders', 'the repeat of a drawn nine-slice'],
  'BitmapText.fontSize': ['renders', 'type metrics — the glyphs are the picture'],
  'Text.fontSize': ['renders', 'type metrics — the glyphs are the picture'],
  'Text.lineHeight': ['renders', 'type metrics — the laid-out lines are the picture'],
  'Text.strokeWidth': ['renders', 'the stroke it draws round its own glyphs'],
  'TextInput.fontSize': ['renders', 'type metrics — the glyphs are the picture'],
  'TrailRenderer.startWidth': ['renders', 'the ribbon drawn at it is the outline'],
  'TrailRenderer.endWidth': ['renders', 'the ribbon drawn at it is the outline'],
  'ParticleEmitter.startSizeMin': ['renders', 'the particles drawn at it are the picture'],
  'ParticleEmitter.startSizeMax': ['renders', 'the particles drawn at it are the picture'],
  'ParticleEmitter.endSizeMin': ['renders', 'the particles drawn at it are the picture'],
  'ParticleEmitter.endSizeMax': ['renders', 'the particles drawn at it are the picture'],
  'ParticleEmitter.trailWidth': ['renders', 'the ribbon drawn at it is the outline'],

  // A world length with no region of its own: it bounds or feeds something else,
  // and a shape drawn for it would claim a place it does not occupy.
  'CharacterController2D.skinWidth': ['no-place', 'a contact skin held off the collider; drawn, it is that outline\'s own line width'],
  'CharacterController3D.stepHeight': ['no-place', 'the tallest step it will climb — a limit on motion, not a volume'],
  'NavVolume.cellSize': ['no-place', 'the voxel the box is diced into; the box is what has a place'],
  'NavVolume.cellHeight': ['no-place', 'the voxel the box is diced into; the box is what has a place'],
  'NavVolume.agentHeight': ['no-place', 'the agent the mesh is baked for, not a region of the volume'],
  'NavVolume.agentRadius': ['no-place', 'the agent the mesh is baked for, not a region of the volume'],
  'NavVolume.stepHeight': ['no-place', 'the agent the mesh is baked for, not a region of the volume'],
  'Light.shadowDistance': ['no-place', 'how far the directional cascade reaches from the CAMERA, so it has no place round this light'],
  'Light.shadowExtent': ['no-place', 'the shadow map\'s coverage, sized on the view rather than on the light\'s own place'],
  'PostProcessVolume.blendDistance': ['no-place', 'a fade band on the volume\'s own edge, which is already drawn'],
  'ParticleEmitter.trailMinDistance': ['no-place', 'how far a particle moves before a trail point is kept — a sampling step'],
  'TrailRenderer.minVertexDistance': ['no-place', 'how far the entity moves before a point is kept — a sampling step'],

  // Not a length in world space at all.
  'Canvas.matchWidthOrHeight': ['not-world', 'a 0..1 blend between two fits, not a length'],
  'UIDropdown.optionHeight': ['not-world', 'a row height inside a laid-out box, resolved by layout rather than placed'],
  'SpriteMask.rangeEndOrder': ['not-world', 'the last draw ORDER a mask reaches, not a distance it reaches over'],
  'LODGroup.lod1Size': ['not-world', 'a fraction of SCREEN height — a property of the view, not of the entity'],
  'LODGroup.lod2Size': ['not-world', 'a fraction of SCREEN height — a property of the view, not of the entity'],
  'LODGroup.lod3Size': ['not-world', 'a fraction of SCREEN height — a property of the view, not of the entity'],
  'LODGroup.cullSize': ['not-world', 'a fraction of SCREEN height — a property of the view, not of the entity'],

  // Each of these IS a region of world and nothing draws it. An entry leaves this
  // block by being drawn, never by being explained; adding one is a visible diff,
  // which is the only ratchet there is.
  'Hunter.attackRange': ['owed', 'the reach it closes to before swinging — MeleeAttack.radius is drawn, this twin is not'],
  'Perceiver.range': ['owed', 'how far it can see; the cone it sees through is not drawn either'],
  'ThirdPersonCamera.distance': ['owed', 'the boom length — where the camera actually ends up'],
  'ThirdPersonCamera.obstructionRadius': ['owed', 'the probe swept along the boom'],
};

const components = JSON.parse(readFileSync(SNAPSHOT, 'utf8')).components;

// The editor is an optional submodule, and it is where every gizmo lives. Without
// it there is nothing to judge — reported, never rounded down to a pass.
if (!existsSync(VIEWPORT)) {
  console.log('check-gizmo-coverage: no editor checkout — the viewport was not scanned,'
    + ' so no component was judged.');
  process.exit(0);
}
const viewport = readFileSync(VIEWPORT, 'utf8');

/** Every authored field a length word could be hiding in. A transient component
 *  is a runtime reading rather than something authored, and a readonly field is
 *  an output — neither is a number anybody sets, so neither can be drawn wrong. */
function discover() {
  const found = [];
  for (const component of components) {
    if (component.transient) continue;
    for (const field of component.fields ?? []) {
      if (field.readonly) continue;
      if (!NUMERIC.test(field.type ?? '')) continue;
      if (!LENGTH_WORDS.test(field.key)) continue;
      found.push({ component: component.name, field: field.key, key: `${component.name}.${field.key}` });
    }
  }
  return found;
}

const discovered = discover();
const problems = [];
const owed = [];
const counts = { extent: 0, renders: 0, 'no-place': 0, 'not-world': 0, owed: 0 };
const unused = new Set(Object.keys(DISPOSITION));

for (const { component, field, key } of discovered) {
  unused.delete(key);
  const disposition = DISPOSITION[key];
  if (!disposition) {
    problems.push(`${key} has no disposition — say what this number is`
      + ' (extent / renders / no-place / not-world), in tools/check-gizmo-coverage.mjs');
    continue;
  }
  const kind = Array.isArray(disposition) ? disposition[0] : disposition;
  if (!(kind in counts)) {
    problems.push(`${key} declares an unknown disposition "${kind}"`);
    continue;
  }
  counts[kind]++;
  if (kind === 'owed') {
    owed.push(`  ${key} — ${disposition[1]}`);
    // An owed extent that IS now named is debt somebody paid without saying so;
    // left in the list it would go on claiming a hole that has been filled.
    if (new RegExp(`\\b${component}\\b`).test(viewport)) {
      problems.push(`${key} is listed as owed, but the viewport now names ${component}`
        + ' — promote it to "extent"');
    }
    continue;
  }
  if (kind !== 'extent') continue;
  // Named in the viewport at all: every gizmo path starts by asking the world for
  // the component, so the name is there by construction when one exists.
  if (new RegExp(`\\b${component}\\b`).test(viewport)) continue;
  problems.push(`${key} is an extent and the viewport never names ${component}`
    + ' — its extent is a number with nothing on screen to show it');
}

for (const key of unused) {
  problems.push(`DISPOSITION names "${key}", which is no longer an authored numeric field`);
}

if (process.argv.includes('--list')) {
  console.log(`discovered ${discovered.length} authored length-ish field(s): `
    + Object.entries(counts).map(([k, n]) => `${k} ${n}`).join(', '));
  if (owed.length) console.log(`owed — an extent nothing draws:\n${owed.join('\n')}`);
}

if (problems.length) {
  console.error(`check-gizmo-coverage: ${problems.length} problem(s)`);
  for (const p of problems) console.error(`  ${p}`);
  console.error('\n  Draw it in ViewportController and add a case to the editor\'s gizmo-chrome check,');
  console.error('  or give the field a disposition saying what its number actually is.');
  process.exit(1);
}
console.log(`check-gizmo-coverage: ${discovered.length} authored length-ish field(s) judged`
  + ` — ${counts.extent} extent(s) drawn, ${counts.renders} self-drawn, ${counts['no-place']} placeless,`
  + ` ${counts['not-world']} not world-space, ${counts.owed} owed (--list names them).`);
