// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect } from 'vitest';
import { Transform } from '../src/ecs/component';
import type { Entity } from '../src/types';
import type { AnyComponentDef, ComponentData } from '../src/ecs/component';
import { Perceiver, Perception, PerceptionTarget } from '../src/ai/perception/components';
import { stepPerception, type PerceptionWorldView } from '../src/ai/perception/PerceptionPlugin';

class FakeWorld implements PerceptionWorldView {
  private store = new Map<string, unknown>();
  private next = 1;
  private ids: Entity[] = [];

  spawn(comps: Array<[AnyComponentDef, unknown]>): Entity {
    const e = this.next++ as Entity;
    for (const [def, data] of comps) this.store.set(`${e}:${def._name}`, data);
    this.ids.push(e);
    return e;
  }
  getEntitiesWithComponents(defs: readonly AnyComponentDef[]): Entity[] {
    return this.ids.filter(e => defs.every(d => this.store.has(`${e}:${d._name}`)));
  }
  get<C extends AnyComponentDef>(e: Entity, def: C): ComponentData<C> {
    return this.store.get(`${e}:${def._name}`) as ComponentData<C>;
  }
  set<C extends AnyComponentDef>(e: Entity, def: C, data: ComponentData<C>): void {
    this.store.set(`${e}:${def._name}`, data);
  }
  has(e: Entity, def: AnyComponentDef): boolean {
    return this.store.has(`${e}:${def._name}`);
  }
  insert<C extends AnyComponentDef>(e: Entity, def: C, data?: Partial<ComponentData<C>>): unknown {
    this.store.set(`${e}:${def._name}`, data);
    return data;
  }
}

const tf = (x: number, y: number, z = 0) => ({ position: { x, y, z }, rotation: { x: 0, y: 0, z: 0, w: 1 } });
const spawnPerceiver = (w: FakeWorld, x: number, y: number, range = 200, fov = 360, z = 0) =>
  w.spawn([[Perceiver, Perceiver.create({ range, fovDegrees: fov })], [Transform, tf(x, y, z)]]);
const spawnTarget = (w: FakeWorld, x: number, y: number, z = 0) =>
  w.spawn([[PerceptionTarget, {}], [Transform, tf(x, y, z)]]);

describe('stepPerception', () => {
  it('writes a visible target into the Perception component', () => {
    const w = new FakeWorld();
    const p = spawnPerceiver(w, 0, 0);
    spawnTarget(w, 50, 0);
    stepPerception(w);
    const per = w.get(p, Perception);
    expect(per.visible).toBe(true);
    expect(per.distance).toBeCloseTo(50);
    expect(per.targetX).toBe(50);
    expect(per.dirX).toBeCloseTo(1);
  });

  it('reports not visible when the target is out of range', () => {
    const w = new FakeWorld();
    const p = spawnPerceiver(w, 0, 0, 100);
    spawnTarget(w, 300, 0);
    stepPerception(w);
    expect(w.get(p, Perception).visible).toBe(false);
  });

  it('honors line-of-sight occlusion', () => {
    const w = new FakeWorld();
    const p = spawnPerceiver(w, 0, 0);
    spawnTarget(w, 80, 0);
    stepPerception(w, () => true); // everything blocked
    expect(w.get(p, Perception).visible).toBe(false);
    stepPerception(w, () => false); // clear
    expect(w.get(p, Perception).visible).toBe(true);
  });

  // The callback is asked about the space BETWEEN two bodies, so it is told
  // which two: a character's collider sits at its feet, so a ray aimed at the
  // origin passes through the target's own capsule on the way in.
  it('tells the occlusion check which two bodies are at the ends of the line', () => {
    const w = new FakeWorld();
    const p = spawnPerceiver(w, 0, 0);
    const t = spawnTarget(w, 80, 0);
    const ends: Array<[number, number]> = [];
    stepPerception(w, (_from, _to, observer, target) => {
      ends.push([observer, target]);
      return false;
    });
    expect(ends).toEqual([[p, t]]);
  });

  // The layer mask is the perceiver's, and it is the only thing standing between
  // a 3D sight ray and the observer's own collider.
  it('hands the perceiver own LOS layers to the occlusion check', () => {
    const w = new FakeWorld();
    w.spawn([[Perceiver, Perceiver.create({ losLayers: 0b110 })], [Transform, tf(0, 0)]]);
    spawnTarget(w, 80, 0);
    const seen: number[] = [];
    stepPerception(w, (_from, _to, _o, _t, layers) => { seen.push(layers); return false; });
    expect(seen).toEqual([0b110]);
  });

  it('sees, and reports, in three dimensions', () => {
    const w = new FakeWorld();
    const p = spawnPerceiver(w, 0, 0, 200);
    spawnTarget(w, 0, 0, 100);
    stepPerception(w);
    const per = w.get(p, Perception);
    expect(per.visible).toBe(true);
    expect(per.targetZ).toBe(100);
    expect(per.dirZ).toBeCloseTo(1);
    expect(per.distance).toBeCloseTo(100);
  });

  // The one a flat range check gets wrong: same x/y, two floors apart.
  it('does not see a target that is only out of range in depth', () => {
    const w = new FakeWorld();
    const p = spawnPerceiver(w, 0, 0, 100);
    spawnTarget(w, 0, 0, 300);
    stepPerception(w);
    expect(w.get(p, Perception).visible).toBe(false);
  });

  it('picks the nearest visible target', () => {
    const w = new FakeWorld();
    const p = spawnPerceiver(w, 0, 0);
    spawnTarget(w, 150, 0);
    spawnTarget(w, 60, 0);
    stepPerception(w);
    expect(w.get(p, Perception).targetX).toBe(60);
  });
});

// Hearing: machines come to a gunshot within 45 m, through the containers between. Unreal's hearing sense is
// the same shape: a noise of some loudness, heard within hearingRange * loudness, walls or not.
describe('stepPerception hearing', () => {
  const noise = (x: number, y: number, loudness = 1, source = 0 as Entity) => ({ x, y, z: 0, loudness, source });
  const listener = (w: FakeWorld, x: number, hearingRange: number) =>
    w.spawn([[Perceiver, Perceiver.create({ range: 10, hearingRange })], [Transform, tf(x, 0)]]);

  it('hears a noise within reach, where it was made, through anything', () => {
    const w = new FakeWorld();
    const p = listener(w, 0, 45);
    stepPerception(w, () => true, [noise(40, 0)], 0.016);
    const per = w.get(p, Perception);
    expect(per.heard).toBe(true);
    expect(per.visible).toBe(false);
    expect([per.noiseX, per.noiseY, per.sinceHeard]).toEqual([40, 0, 0]);
  });

  it('does not hear past its range scaled by loudness, nor a noise of its own, and a deaf one hears nothing', () => {
    const w = new FakeWorld();
    const p = listener(w, 0, 45);
    const deaf = listener(w, 0, 0);
    stepPerception(w, undefined, [noise(50, 0), noise(20, 0, 0.4), noise(1, 0, 1, p)], 0.016);
    expect(w.get(p, Perception).heard).toBe(false);
    expect(w.get(deaf, Perception).heard).toBe(false);
    stepPerception(w, undefined, [noise(80, 0, 2)], 0.016);
    expect(w.get(p, Perception).heard).toBe(true);
  });

  it('keeps where it last heard something, older each step, until it hears again', () => {
    const w = new FakeWorld();
    const p = listener(w, 0, 45);
    stepPerception(w, undefined, [], 0.5);
    expect(w.get(p, Perception).sinceHeard).toBe(-1);
    stepPerception(w, undefined, [noise(10, 5)], 0.5);
    stepPerception(w, undefined, [], 0.5);
    stepPerception(w, undefined, [], 0.25);
    const per = w.get(p, Perception);
    expect([per.heard, per.noiseX, per.noiseY, per.sinceHeard]).toEqual([false, 10, 5, 0.75]);
  });
});

// A perceiver on an eye and a target on an eye: both are children, and their own positions are near the origin.
describe('stepPerception in the world', () => {
  it('senses from and to WORLD positions where the world keeps them', () => {
    const w = new FakeWorld();
    const eye = w.spawn([[Perceiver, Perceiver.create({ range: 100 })],
      [Transform, { position: { x: 0, y: 0.6, z: 0 }, worldPosition: { x: 10, y: 1.6, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 }, worldRotation: { x: 0, y: 0, z: 0, w: 1 } }]]);
    w.spawn([[PerceptionTarget, {}], [Transform, { position: { x: 0, y: 0.7, z: 0 }, worldPosition: { x: 40, y: 1.6, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } }]]);
    stepPerception(w);
    const per = w.get(eye, Perception);
    expect(per.visible).toBe(true);
    expect(per.distance).toBeCloseTo(30);
    expect(per.targetX).toBe(40);
  });
});
