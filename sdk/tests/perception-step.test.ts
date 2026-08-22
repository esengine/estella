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
