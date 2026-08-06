// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Every API the built-in agent's brief teaches, written the way the brief
 *        teaches it — compiled by agent-brief-compiles.test.ts.
 *
 * The brief told the agent to call `input.isMouseButtonPressed(MouseButton.Left)`
 * for six months. `MouseButton` is the InputMap binding builder and has no
 * `.Left`, so the call passed `undefined` and read false forever: every game the
 * agent built ignored the mouse, silently, and the agent had no way to find out.
 * Prose about an API is code that nothing compiles. This file is that code.
 */
import {
  addSystemToSchedule,
  defineComponent,
  defineSystem,
  CameraView,
  Commands,
  Input,
  Material,
  Mesh2D,
  Meshes2D,
  MouseButton,
  Mut,
  Query,
  Res,
  Schedule,
  Sprite,
  Time,
  Transform,
} from 'esengine';

export const Marker = defineComponent('AgentBriefMarker', { speed: 100 });

const drift = defineSystem([Query(Mut(Transform)), Res(Time)], (q, t) => {
  for (const [, transform] of q) {
    transform.position.x += t.delta;
  }
});

const pointer = defineSystem(
  [Res(Input), Res(CameraView), Commands()],
  (input, camera, commands) => {
    if (!input.isMouseButtonPressed(0)) return;
    const screen: [number, number] = [input.mouseX, input.mouseY];
    const world = camera.screenToWorld(screen[0], screen[1]) ?? camera.getWorldMousePosition();
    if (!world) return;
    commands.spawn('Placed').insert(Transform, { position: { x: world.x, y: world.y, z: 0 } });
  },
);

// A material parameter driven from a system: at run time the component's
// `material` field IS the handle setUniform takes, which is the half of this the
// brief has to say out loud — it reads like an asset ref everywhere else.
const dissolve = defineSystem([Query(Sprite), Res(Time)], (q, time) => {
  for (const [, sprite] of q) {
    Material.setUniform(sprite.material, 'u_amount', Math.sin(time.elapsed));
  }
});

// Mesh geometry: not a component field, uploaded through the resource.
const mesh = defineSystem([Query(Mesh2D), Res(Meshes2D)], (q, meshes) => {
  for (const [entity] of q) {
    meshes.setGeometry(entity, { positions: [0, 0, 32, 0, 0, 32], indices: [0, 1, 2] });
  }
});

// The binding builder the brief distinguishes from the raw button number.
export const leftClickBinding = MouseButton(0);

addSystemToSchedule(Schedule.Update, drift);
addSystemToSchedule(Schedule.Update, pointer);
addSystemToSchedule(Schedule.Update, dissolve);
addSystemToSchedule(Schedule.Update, mesh);
