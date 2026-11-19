// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  StateDrivenCamera: the camera an Animator's state names is the one switched on, after its rule's wait, and a
 *        camera is held at least its minimum once live. Pure logic over a mock world, with a stand-in Animator.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { World } from '../src/ecs/world';
import { Camera, Name, defineComponent, getComponent } from '../src/ecs/component';
import { StateDrivenCamera, stateDrivenCameraUpdate, cameraForState } from '../src/camera/StateDrivenCamera';
import type { Entity } from '../src/types';
import { createMockModule } from './mocks/wasm';

// The engine's Animator where the animation module is loaded; a stand-in of the same name and fields here.
const Animator = getComponent('Animator') ?? defineComponent('Animator', { controller: '', avatar: '', currentState: '', layerStates: [] as string[], enabled: true });

describe('cameraForState', () => {
  const data = { animator: 1, layer: 0, defaultCamera: 'Walk Cam', rules: [
    { state: 'Run', camera: 'Run Cam', wait: 0.2, minDuration: 0 },
    { state: 'Aim', camera: 'Aim Cam', wait: 0, minDuration: 1 },
  ] };
  it('takes the rule naming the state, else the default camera', () => {
    expect(cameraForState(data, 'Run')).toEqual({ camera: 'Run Cam', wait: 0.2, minDuration: 0 });
    expect(cameraForState(data, 'Idle')).toEqual({ camera: 'Walk Cam', wait: 0, minDuration: 0 });
    expect(cameraForState({ ...data, defaultCamera: '' }, 'Idle')).toBeNull();
  });
});

describe('stateDrivenCameraUpdate', () => {
  let world: World;
  let hero: Entity;
  const cams: Record<string, Entity> = {};
  beforeEach(() => {
    world = new World();
    const mod = createMockModule();
    world.connectCpp(mod.getRegistry(), mod);
    hero = world.spawn('hero');
    world.insert(hero, Animator, { currentState: 'Idle' });
    for (const n of ['Walk Cam', 'Run Cam', 'Aim Cam', 'Other']) {
      const e = world.spawn(n);
      world.insert(e, Name, { value: n });
      world.insert(e, Camera, { isActive: true });
      cams[n] = e;
    }
    const m = world.spawn('director');
    world.insert(m, StateDrivenCamera, { animator: hero, layer: 0, defaultCamera: 'Walk Cam', rules: [
      { state: 'Run', camera: 'Run Cam', wait: 0.2, minDuration: 0 },
      { state: 'Aim', camera: 'Aim Cam', wait: 0, minDuration: 1 },
    ] });
  });
  const on = () => Object.entries(cams).filter(([, e]) => world.get(e, Camera).isActive).map(([n]) => n).sort();
  const state = (s: string) => world.insert(hero, Animator, { ...world.get(hero, Animator), currentState: s });

  it('switches on only the camera the state asks for, leaving cameras it does not name alone', () => {
    stateDrivenCameraUpdate(world, 1 / 60);
    expect(on()).toEqual(['Other', 'Walk Cam']);
  });

  it('waits out a rule\'s wait, so a state passed through does not flick the view', () => {
    stateDrivenCameraUpdate(world, 1 / 60);
    state('Run');
    stateDrivenCameraUpdate(world, 0.1);
    expect(on()).toContain('Walk Cam');
    state('Idle');
    stateDrivenCameraUpdate(world, 0.1);
    state('Run');
    stateDrivenCameraUpdate(world, 0.1);
    stateDrivenCameraUpdate(world, 0.1);
    expect(on()).toContain('Walk Cam');
    stateDrivenCameraUpdate(world, 0.1);
    expect(on()).toEqual(['Other', 'Run Cam']);
  });

  it('holds a camera its minimum once live, then follows the state', () => {
    stateDrivenCameraUpdate(world, 1 / 60);
    state('Aim');
    stateDrivenCameraUpdate(world, 0.1);
    expect(on()).toContain('Aim Cam');
    state('Idle');
    stateDrivenCameraUpdate(world, 0.5);
    expect(on()).toContain('Aim Cam');
    stateDrivenCameraUpdate(world, 0.6);
    expect(on()).toEqual(['Other', 'Walk Cam']);
  });
});
