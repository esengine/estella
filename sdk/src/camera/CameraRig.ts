// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    CameraRig.ts
 * @brief   The camera pipeline: what moves each camera this frame, in a fixed order, and the brain that picks the view.
 *
 * @details Every Camera entity is a virtual camera: a view the scene describes. One of them is drawn, the live one, chosen
 *          and blended into by the director (CameraDirector.ts). This file is the procedural half
 *          each camera runs before it, in these stages:
 *
 *            1. position  where the camera stands    FollowTarget, CameraDolly, PositionComposer (a camera uses one)
 *            2. rotation  where it looks             LookAtTarget
 *            3. finalize  limits on the result       GroupFraming (size the shot to a CameraTargetGroup),
 *                                                   CameraDeoccluder (keep the target in sight), CameraBounds
 *            4. noise     drift on the drawn view    CameraNoise, CameraImpulseListener (CameraPlugin, on the view,
 *                                                   before the blend)
 *
 *          A stage decides in the world and writes through the camera's parent (cameraPlace.ts), the world value beside the
 *          local one, so a stage reads what the stages before it wrote this frame: a camera that follows and looks at one
 *          target aims from where it stands now. Noise and shake move what is drawn and never the camera's Transform:
 *          noise per camera before the director blends, shake on
 *          the blended view after it.
 */
import { defineComponent, Name } from '../ecs/component';
import type { World } from '../ecs/world';
import type { Entity } from '../types';
import { BlendCurve, type CameraDirectorState, type CustomBlend } from './CameraDirector';
import { followUpdate } from './FollowTarget';
import { dollyUpdate } from './CameraDolly';
import { positionComposerUpdate } from './PositionComposer';
import { lookAtUpdate } from './LookAtTarget';
import { cameraBoundsUpdate } from './CameraBounds';
import { deoccluderRestore, deoccluderUpdate, type CameraCollisionProbe } from './CameraDeoccluder';
import { targetGroupUpdate, groupFramingRestore, groupFramingUpdate } from './CameraTargetGroup';
import { impulseSourceUpdate } from './CameraImpulse';
import { stateDrivenCameraUpdate } from './StateDrivenCamera';

export interface CameraBrainData {
  /**
   * Seconds the view takes to move to a camera that becomes live without being asked for: a higher priority, a camera
   * turned on or off, isActive moved. 0 cuts. A setViewTarget names its own blend and is not changed by this.
   */
  defaultBlend: number;
  /** The easing of that blend (BlendCurve: 0 linear, 1 ease in, 2 ease out, 3 ease in and out). */
  blendCurve: number;
  /**
   * Blends for particular changes of camera: from a camera to another, by their names,
   * an empty name for any camera. The first naming both ends wins, then one naming the camera blended to, then the one
   * blended from; any other change takes the default.
   */
  customBlends: CameraBrainBlend[];
}

/** One of a brain's custom blends: camera names, '' for any. */
export interface CameraBrainBlend {
  from: string;
  to: string;
  time: number;
  curve: number;
}

const CURVES = [
  { label: 'Linear', value: BlendCurve.Linear },
  { label: 'Ease in', value: BlendCurve.EaseIn },
  { label: 'Ease out', value: BlendCurve.EaseOut },
  { label: 'Ease in and out', value: BlendCurve.EaseInOut },
];

/**
 * How the view changes cameras, for the scene it is in: which camera is live, and the blend it gives
 * a new view target. One per scene, on any entity; a scene without one cuts, as every scene did before it existed.
 */
export const CameraBrain = defineComponent<CameraBrainData>('CameraBrain', {
  defaultBlend: 1,
  blendCurve: BlendCurve.EaseInOut,
  customBlends: [],
}, {
  fields: {
    defaultBlend: { min: 0, step: 0.1, unit: 's', tooltip: 'Seconds the view takes to move to a camera that becomes live; 0 cuts.' },
    blendCurve: { enum: CURVES, tooltip: 'The easing of that blend.' },
    customBlends: {
      tooltip: 'Blends for particular changes of camera, by camera name; an empty name is any camera. Time 0 cuts.',
      records: {
        columns: [
          { key: 'from', label: 'From', kind: 'string', placeholder: 'Any camera' },
          { key: 'to', label: 'To', kind: 'string', placeholder: 'Any camera' },
          { key: 'time', label: 'Seconds', kind: 'number', min: 0, step: 0.1 },
          { key: 'curve', label: 'Curve', kind: 'number', enum: CURVES },
        ],
        defaults: { from: '', to: '', time: 1, curve: BlendCurve.EaseInOut },
      },
    },
  },
});

/** Every named entity, by name: what a custom blend's names are looked up in. The first of a name wins. */
function namesIn(world: World): Map<string, number> {
  const out = new Map<string, number>();
  for (const e of world.getEntitiesWithComponents([Name])) {
    const n = world.get(e, Name).value;
    if (n && !out.has(n)) out.set(n, e as number);
  }
  return out;
}

/** The last resolve per world: what the blends said, and the entity each name was found on. */
const resolved = new WeakMap<World, { key: string; names: Map<string, number>; complete: boolean; out: CustomBlend[] }>();

/**
 * A brain's custom blends with their names turned to entities; a name nothing has is dropped with its blend. Looked up
 * again only when the blends change, an entity found no longer carries its name, or a name was not found last time:
 * every frame would walk every named entity of the scene.
 */
export function resolveCustomBlends(world: World, blends: readonly CameraBrainBlend[]): CustomBlend[] {
  if (blends.length === 0) return [];
  const key = JSON.stringify(blends);
  const last = resolved.get(world);
  if (last && last.key === key && last.complete) {
    let still = true;
    for (const [n, e] of last.names) {
      const ent = e as Entity;
      if (!world.valid(ent) || !world.has(ent, Name) || world.get(ent, Name).value !== n) { still = false; break; }
    }
    if (still) return last.out;
  }
  const all = namesIn(world);
  const names = new Map<string, number>();
  let complete = true;
  for (const b of blends) {
    for (const n of [b.from, b.to]) {
      if (!n) continue;
      const e = all.get(n);
      if (e === undefined) complete = false;
      else names.set(n, e);
    }
  }
  const out = resolveWith(names, blends);
  resolved.set(world, { key, names, complete, out });
  return out;
}

function resolveWith(names: ReadonlyMap<string, number>, blends: readonly CameraBrainBlend[]): CustomBlend[] {
  const out: CustomBlend[] = [];
  for (const b of blends) {
    const from = b.from ? names.get(b.from) : -1;
    const to = b.to ? names.get(b.to) : -1;
    if (from === undefined || to === undefined) continue;
    out.push({ from, to, time: Math.max(0, Number(b.time) || 0), curve: Number(b.curve) || 0 });
  }
  return out;
}

/** The brain's settings into the director: the first CameraBrain in the scene, or a cut when there is none. */
export function syncCameraBrain(world: World, director: CameraDirectorState): void {
  const brain = world.getEntitiesWithComponents([CameraBrain])[0];
  if (brain === undefined) {
    director.defaultBlend = 0;
    director.customBlends = [];
    return;
  }
  const data = world.get(brain, CameraBrain);
  director.defaultBlend = Math.max(0, data.defaultBlend);
  director.defaultCurve = data.blendCurve;
  director.customBlends = resolveCustomBlends(world, data.customBlends ?? []);
}

/**
 * One frame of every camera's pipeline, stage by stage. `screenAspect` is the width over the height of the screen the
 * cameras draw on (0 while it is not known), each camera measured by its share of it (cameraAspect.ts); `director` is
 * null where no view is resolved; `collision` is what the deoccluder sweeps with (the 3D physics plugin's), or null.
 */
export function cameraRigUpdate(
  world: World, dt: number, screenAspect: number, director: CameraDirectorState | null,
  collision: CameraCollisionProbe | null = null,
): void {
  if (director) syncCameraBrain(world, director);
  // Which cameras are on, by what an Animator is doing, before anything moves them: the director picks among them.
  stateDrivenCameraUpdate(world, dt);
  // Last frame's corrections (the deoccluder's pull, the group framing's dolly) are theirs, not the rig's: taken back
  // first, in the reverse of the order they were made, so the stages work from where the rig wants each camera.
  deoccluderRestore(world);
  groupFramingRestore(world);
  // Groups stand where their members are before anything frames them.
  targetGroupUpdate(world);
  followUpdate(world, dt);
  dollyUpdate(world, dt);
  positionComposerUpdate(world, dt, screenAspect);
  lookAtUpdate(world, dt, screenAspect);
  groupFramingUpdate(world, dt, screenAspect);
  deoccluderUpdate(world, dt, collision);
  cameraBoundsUpdate(world, screenAspect);
  // Impulse sources asked to fire (their flag set by a timeline, a visual script or the inspector) go off where they are.
  impulseSourceUpdate(world);
}
