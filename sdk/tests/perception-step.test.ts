// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect } from 'vitest';
import { Transform } from '../src/component';
import type { Entity } from '../src/types';
import type { AnyComponentDef, ComponentData } from '../src/component';
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

const tf = (x: number, y: number) => ({ position: { x, y, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } });
const spawnPerceiver = (w: FakeWorld, x: number, y: number, range = 200, fov = 360) =>
  w.spawn([[Perceiver, Perceiver.create({ range, fovDegrees: fov })], [Transform, tf(x, y)]]);
const spawnTarget = (w: FakeWorld, x: number, y: number) =>
  w.spawn([[PerceptionTarget, {}], [Transform, tf(x, y)]]);

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

  it('picks the nearest visible target', () => {
    const w = new FakeWorld();
    const p = spawnPerceiver(w, 0, 0);
    spawnTarget(w, 150, 0);
    spawnTarget(w, 60, 0);
    stepPerception(w);
    expect(w.get(p, Perception).targetX).toBe(60);
  });
});
