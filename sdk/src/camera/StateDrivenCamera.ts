// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    StateDrivenCamera.ts
 * @brief   Which camera is live, by what an Animator is doing: Cinemachine's State-Driven Camera.
 *
 * @details A character walking is seen by one camera, sprinting by a lower, wider one, aiming by one over its shoulder.
 *          A `StateDrivenCamera` names the Animator to watch and, per state, the camera that goes with it. The cameras it
 *          names are switched on and off (`Camera.isActive`) so that only the one for the state is, and the brain blends
 *          into it as into any camera that goes live: its default blend or a custom blend between those two cameras,
 *          and a CameraEvent says so. A rule can wait before switching, so a state passed through on the way to another
 *          does not flick the view, and a camera can be held at least a while once live.
 *
 *          Cameras are named, as the brain's custom blends name them. A state with no rule, or an empty state, takes the
 *          default camera; with none named, the view stays as it is.
 */
import { defineComponent, getComponent, Camera, Name } from '../ecs/component';
import type { World } from '../ecs/world';
import { INVALID_ENTITY, type Entity } from '../types';

export interface StateCameraRule {
  /** The Animator state (its full path, as the Animator reports it). */
  state: string;
  /** The camera live while in it, by name. */
  camera: string;
  /** Seconds the state must last before the camera changes to this one; 0 at once. */
  wait: number;
  /** Seconds this camera stays live at least, once it is, whatever the state does. */
  minDuration: number;
}

export interface StateDrivenCameraData {
  /** The entity whose Animator is watched. */
  animator: number;
  /** Which of its layers: 0 the base. */
  layer: number;
  /** The camera for each state. */
  rules: StateCameraRule[];
  /** The camera for a state no rule names; empty leaves the view as it is. */
  defaultCamera: string;
}

export const StateDrivenCamera = defineComponent<StateDrivenCameraData>('StateDrivenCamera', {
  animator: INVALID_ENTITY,
  layer: 0,
  rules: [],
  defaultCamera: '',
}, {
  entityFields: ['animator'],
  fields: {
    animator: { tooltip: 'The entity whose Animator is watched.' },
    layer: { min: 0, step: 1, advanced: true, tooltip: 'Which layer of its controller: 0 is the base.' },
    rules: {
      tooltip: 'The camera live in each Animator state, by name. Wait delays the change; Hold keeps a camera live at least that long.',
      records: {
        columns: [
          { key: 'state', label: 'State', kind: 'string', placeholder: 'Run' },
          { key: 'camera', label: 'Camera', kind: 'string', placeholder: 'Camera name' },
          { key: 'wait', label: 'Wait (s)', kind: 'number', min: 0, step: 0.1 },
          { key: 'minDuration', label: 'Hold (s)', kind: 'number', min: 0, step: 0.1 },
        ],
        defaults: { state: '', camera: '', wait: 0, minDuration: 0 },
      },
    },
    defaultCamera: { tooltip: 'The camera for a state no rule names; empty leaves the view as it is.' },
  },
});

/** Per manager: the camera it made live and for how long, and a change waiting out its rule's wait. */
interface Run {
  live: string;
  heldFor: number;
  pending: { camera: string; since: number } | null;
  state: string;
}

const runs = new WeakMap<World, Map<Entity, Run>>();

/** The entity named `name` among `cameras`, or undefined. */
function cameraNamed(world: World, cameras: readonly Entity[], name: string): Entity | undefined {
  for (const e of cameras) if (world.has(e, Name) && world.get(e, Name).value === name) return e;
  return undefined;
}

/** The Animator's state on `layer`, read through the registry so the camera module carries no animation code. */
function animatorState(world: World, entity: Entity, layer: number): string | null {
  const def = getComponent('Animator');
  if (!def || !world.valid(entity) || !world.has(entity, def)) return null;
  const a = world.get(entity, def) as { currentState?: string; layerStates?: string[] };
  return layer === 0 ? a.currentState ?? '' : a.layerStates?.[layer - 1] ?? '';
}

/**
 * The camera a state asks for under `rules`, and its rule: the rule naming the state, else the default camera.
 * Exported for tests.
 */
export function cameraForState(data: StateDrivenCameraData, state: string): { camera: string; wait: number; minDuration: number } | null {
  const rule = data.rules.find((r) => r.state !== '' && r.state === state);
  if (rule) return { camera: rule.camera, wait: Math.max(0, rule.wait || 0), minDuration: Math.max(0, rule.minDuration || 0) };
  return data.defaultCamera ? { camera: data.defaultCamera, wait: 0, minDuration: 0 } : null;
}

/** Switches each state-driven camera's cameras to the one its Animator's state asks for (a rig update, in play). */
export function stateDrivenCameraUpdate(world: World, dt: number): void {
  const managers = world.getEntitiesWithComponents([StateDrivenCamera]);
  if (managers.length === 0) return;
  let all = runs.get(world);
  if (!all) runs.set(world, (all = new Map()));
  const cameras = world.getEntitiesWithComponents([Camera, Name]);
  for (const m of managers) {
    const data = world.get(m, StateDrivenCamera);
    const state = data.animator > 0 ? animatorState(world, data.animator as Entity, Math.max(0, data.layer | 0)) : null;
    if (state === null) continue;
    let run = all.get(m);
    const ask = cameraForState(data, state);
    if (!run) {
      // The first frame: whatever the state asks for, at once.
      run = { live: ask?.camera ?? '', heldFor: 0, pending: null, state };
      all.set(m, run);
    } else {
      run.heldFor += dt;
      if (state !== run.state) {
        run.state = state;
        run.pending = ask && ask.camera !== run.live ? { camera: ask.camera, since: 0 } : null;
      } else if (run.pending) {
        run.pending.since += dt;
      }
      const liveRule = data.rules.find((r) => r.camera === run!.live);
      const hold = liveRule ? Math.max(0, liveRule.minDuration || 0) : 0;
      if (run.pending && ask && run.pending.since >= ask.wait && run.heldFor >= hold) {
        run.live = run.pending.camera;
        run.heldFor = 0;
        run.pending = null;
      }
    }
    if (!run.live) continue;
    // Every camera the manager names is on only while it is the one: the brain then blends into it.
    const named = new Set([...data.rules.map((r) => r.camera), data.defaultCamera].filter(Boolean));
    for (const n of named) {
      const e = cameraNamed(world, cameras, n);
      if (e === undefined) continue;
      const cam = world.get(e, Camera);
      const on = n === run.live;
      if (cam.isActive !== on) world.set(e, Camera, { ...cam, isActive: on });
    }
  }
}
