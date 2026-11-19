// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    CameraRig.ts
 * @brief   The camera pipeline: what moves each camera this frame, in a fixed order, and the brain that picks the view.
 *
 * @details Every Camera entity is a virtual camera: a view the scene describes. One of them is drawn, the live one, chosen
 *          and blended into by the director (CameraDirector.ts). Unity's Cinemachine Brain and UE's PlayerCameraManager
 *          are that director; this file is the procedural half each camera runs before it, in the stages Cinemachine
 *          names and UE's camera rigs order the same way:
 *
 *            1. position  where the camera stands    FollowTarget, CameraDolly, PositionComposer (a camera uses one)
 *            2. rotation  where it looks             LookAtTarget
 *            3. finalize  limits on the result       CameraDeoccluder (keep the target in sight), CameraBounds
 *            4. noise     drift on the drawn view    CameraNoise (CameraPlugin, on the view, before the blend)
 *
 *          A stage decides in the world and writes through the camera's parent (cameraPlace.ts), the world value beside the
 *          local one, so a stage reads what the stages before it wrote this frame: a camera that follows and looks at one
 *          target aims from where it stands now. Noise and shake move what is drawn and never the camera's Transform, as
 *          Cinemachine's noise and Impulse and a UE camera shake do: noise per camera before the director blends, shake on
 *          the blended view after it.
 */
import { defineComponent } from '../ecs/component';
import type { World } from '../ecs/world';
import { BlendCurve, type CameraDirectorState } from './CameraDirector';
import { followUpdate } from './FollowTarget';
import { dollyUpdate } from './CameraDolly';
import { positionComposerUpdate } from './PositionComposer';
import { lookAtUpdate } from './LookAtTarget';
import { cameraBoundsUpdate } from './CameraBounds';
import { deoccluderRestore, deoccluderUpdate, type CameraCollisionProbe } from './CameraDeoccluder';

export interface CameraBrainData {
  /**
   * Seconds the view takes to move to a camera that becomes live without being asked for: a higher priority, a camera
   * turned on or off, isActive moved. 0 cuts. A setViewTarget names its own blend and is not changed by this.
   */
  defaultBlend: number;
  /** The easing of that blend (BlendCurve: 0 linear, 1 ease in, 2 ease out, 3 ease in and out). */
  blendCurve: number;
}

/**
 * How the view changes cameras, for the scene it is in: Cinemachine's Brain, and the blend UE's PlayerCameraManager gives
 * a new view target. One per scene, on any entity; a scene without one cuts, as every scene did before it existed.
 */
export const CameraBrain = defineComponent<CameraBrainData>('CameraBrain', {
  defaultBlend: 1,
  blendCurve: BlendCurve.EaseInOut,
});

/** The brain's settings into the director: the first CameraBrain in the scene, or a cut when there is none. */
export function syncCameraBrain(world: World, director: CameraDirectorState): void {
  const brain = world.getEntitiesWithComponents([CameraBrain])[0];
  if (brain === undefined) {
    director.defaultBlend = 0;
    return;
  }
  const data = world.get(brain, CameraBrain);
  director.defaultBlend = Math.max(0, data.defaultBlend);
  director.defaultCurve = data.blendCurve;
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
  // Last frame's pull toward the target is the deoccluder's, not the rig's: taken back first, so the stages work from
  // where the rig wants each camera.
  deoccluderRestore(world);
  followUpdate(world, dt);
  dollyUpdate(world, dt);
  positionComposerUpdate(world, dt, screenAspect);
  lookAtUpdate(world, dt, screenAspect);
  deoccluderUpdate(world, dt, collision);
  cameraBoundsUpdate(world, screenAspect);
}
