// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    ai-enemy-integration.test.ts
 * @brief   Cross-layer AI integration: an FSM whose Chase action retargets a
 *          NavAgent, driven end-to-end through the real step functions. Exercises
 *          the AI1 (nav) + AI2 (fsm) seam that unit tests cover only in isolation.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { Transform } from '../src/ecs/component';
import type { Entity } from '../src/types';
import type { CommandsInstance } from '../src/ecs/commands';
import type { AnyComponentDef, ComponentData } from '../src/ecs/component';
import { NavGrid } from '../src/ai/nav/NavGrid';
import { Navigation } from '../src/ai/nav/Navigation';
import { NavAgent, setNavDestination } from '../src/ai/nav/NavAgent';
import { stepNavigation, type AgentRuntime } from '../src/ai/nav/NavPlugin';
import { StateMachineAgent, registerFsm, clearFsmStore } from '../src/ai/fsm/StateMachineAgent';
import { aiRegistry, registerAction } from '../src/ai/fsm/AiContext';
import { stepStateMachines, agentBlackboard } from '../src/ai/fsm/FsmPlugin';

const NO_COMMANDS = {} as CommandsInstance;

/** In-memory world with real component-set filtering, shared by both AI systems. */
class FakeWorld {
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
}

const tf = (x: number, y: number) => ({ position: { x, y, z: 0 } });

describe('enemy AI (FSM + navigation)', () => {
  beforeEach(() => {
    aiRegistry.clear();
    clearFsmStore();
  });

  it('patrols while the player is far, then chases via the nav agent when sensed', () => {
    const world = new FakeWorld();
    const nav = new Navigation();
    nav.setSurface(new NavGrid({ width: 40, height: 40, cellSize: 20 })); // open 800x800 grid
    const fsmStates = new Map();
    const navRuntimes = new Map<Entity, AgentRuntime>();

    const enemy = world.spawn([
      [StateMachineAgent, StateMachineAgent.create({ fsm: 'enemy' })],
      [NavAgent, NavAgent.create({ speed: 200, repathInterval: 0 })],
      [Transform, tf(100, 100)],
    ]);
    const player = world.spawn([[Transform, tf(600, 100)]]);

    // Chase = point the nav agent at the player's current position each tick.
    registerAction('chase', ctx => {
      const p = world.get(player, Transform);
      setNavDestination(ctx.world, ctx.entity, { x: p.position.x, y: p.position.y });
    });
    registerAction('patrol', () => { /* hold position */ });

    registerFsm('enemy', {
      initial: 'Patrol',
      states: [
        { name: 'Patrol', onUpdate: 'patrol', transitions: [{ to: 'Chase', guard: { key: 'seesPlayer', op: 'truthy' } }] },
        { name: 'Chase', onUpdate: 'chase', transitions: [{ to: 'Patrol', guard: { key: 'seesPlayer', op: 'falsy' } }] },
      ],
    });

    const SENSE_RANGE = 120;
    const dt = 1 / 60;
    const frame = () => {
      // Perception: write the blackboard the FSM guard reads.
      const e = world.get(enemy, Transform);
      const p = world.get(player, Transform);
      const dist = Math.hypot(p.position.x - e.position.x, p.position.y - e.position.y);
      agentBlackboard(fsmStates, enemy).set('seesPlayer', dist < SENSE_RANGE);
      stepStateMachines(world, NO_COMMANDS, dt, fsmStates);
      stepNavigation(world, nav, dt, navRuntimes);
    };

    // Player far → patrol, enemy stays put.
    for (let i = 0; i < 30; i++) frame();
    expect(world.get(enemy, StateMachineAgent).current).toBe('Patrol');
    expect(world.get(enemy, Transform).position).toMatchObject({ x: 100, y: 100 });

    // Player walks into sensing range.
    world.set(player, Transform, tf(190, 100));
    const startX = world.get(enemy, Transform).position.x;
    for (let i = 0; i < 60; i++) frame();

    // Enemy switched to Chase and the nav agent carried it toward the player.
    expect(world.get(enemy, StateMachineAgent).current).toBe('Chase');
    const endX = world.get(enemy, Transform).position.x;
    expect(endX).toBeGreaterThan(startX + 20);           // moved toward the player
    // Arrived near the player — the goal snaps to the nearest cell center
    // (round(190/20)=10 → world 200), so it lands within a cell of the player.
    expect(Math.abs(endX - 190)).toBeLessThan(35);
    expect(world.get(enemy, Transform).position.y).toBeCloseTo(100, 0);
  });

  it('breaks off the chase and returns to patrol when the player escapes', () => {
    const world = new FakeWorld();
    const nav = new Navigation();
    nav.setSurface(new NavGrid({ width: 40, height: 40, cellSize: 20 }));
    const fsmStates = new Map();
    const navRuntimes = new Map<Entity, AgentRuntime>();

    const enemy = world.spawn([
      [StateMachineAgent, StateMachineAgent.create({ fsm: 'enemy' })],
      [NavAgent, NavAgent.create({ speed: 150, repathInterval: 0 })],
      [Transform, tf(100, 100)],
    ]);
    world.spawn([[Transform, tf(0, 0)]]);

    registerAction('chase', () => { /* not needed for this assertion */ });
    registerFsm('enemy', {
      initial: 'Patrol',
      states: [
        { name: 'Patrol', transitions: [{ to: 'Chase', guard: { key: 'seesPlayer', op: 'truthy' } }] },
        { name: 'Chase', onUpdate: 'chase', transitions: [{ to: 'Patrol', guard: { key: 'seesPlayer', op: 'falsy' } }] },
      ],
    });

    const dt = 1 / 60;
    const setSeen = (v: boolean) => agentBlackboard(fsmStates, enemy).set('seesPlayer', v);

    setSeen(true);
    stepStateMachines(world, NO_COMMANDS, dt, fsmStates); // → Chase
    expect(world.get(enemy, StateMachineAgent).current).toBe('Chase');

    setSeen(false);
    stepStateMachines(world, NO_COMMANDS, dt, fsmStates); // → Patrol
    expect(world.get(enemy, StateMachineAgent).current).toBe('Patrol');
  });
});
