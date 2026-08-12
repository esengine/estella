// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Reading the running game by name — the shapes an agent gets back.
 *
 * The claims here are about what an answer says, because that is what decides
 * whether the next call is the right one: a capped list read as the whole world
 * is how a search concludes something is not there, and an empty timing list
 * read as "nothing ran" is the opposite of "nobody was counting".
 */
import { describe, it, expect } from 'vitest';
import {
  inspectEntity, findEntities, readResources, readSystems, bounded, MAX_VALUE_JSON,
  type Realm,
} from '@/engine/playQuery';

interface Spec {
  name?: string | null;
  parent?: number | null;
  children?: number[];
  components?: Record<string, unknown>;
}

function fakeRealm(
  entities: Record<number, Spec>,
  over: Partial<Pick<Realm, 'resources' | 'timings' | 'entityCount'>> = {},
): Realm {
  const ids = Object.keys(entities).map(Number);
  const at = (e: number) => entities[e] ?? {};
  return {
    entities: () => ids,
    componentsOf: (e) => Object.keys(at(e).components ?? {}),
    read: (e, type) => at(e).components?.[type] ?? null,
    nameOf: (e) => at(e).name ?? null,
    parentOf: (e) => at(e).parent ?? null,
    childrenOf: (e) => at(e).children ?? [],
    resources: over.resources ?? (() => []),
    timings: over.timings ?? (() => ({ systems: new Map(), phases: new Map() })),
    entityCount: over.entityCount ?? (() => ids.length),
  };
}

describe('one entity, whole', () => {
  const realm = fakeRealm({
    7: {
      name: 'Skeleton',
      parent: 3,
      children: [8],
      components: {
        Transform: { x: 27, y: 81 },
        Health: { current: 40, max: 100 },
        StateMachineAgent: { current: 'chase' },
      },
    },
  });

  // The shape the whole thing exists for: what IS this, in one call, rather
  // than a list of names and one fetch per name.
  it('answers with the name and every component, not a list to fetch from', () => {
    expect(inspectEntity(realm, 7)).toEqual({
      entity: 7,
      name: 'Skeleton',
      parent: 3,
      children: [8],
      components: {
        Transform: { x: 27, y: 81 },
        Health: { current: 40, max: 100 },
        StateMachineAgent: { current: 'chase' },
      },
    });
  });

  // AI, animation, physics and UI state are components, so asking for the
  // entity is asking for all of them — there is no per-domain query to know.
  it('carries the subsystem state, because that state IS components', () => {
    const components = inspectEntity(realm, 7).components;
    expect(components.StateMachineAgent).toEqual({ current: 'chase' });
  });

  it('says an entity is not there rather than answering about an empty one', () => {
    expect(() => inspectEntity(realm, 99)).toThrow(/no entity 99/);
  });
});

describe('which entities there are', () => {
  const realm = fakeRealm({
    1: { name: 'Player', components: { Transform: {}, Health: {} } },
    2: { name: 'Skeleton A', components: { Transform: {}, Health: {}, StateMachineAgent: {} } },
    3: { name: 'Skeleton B', components: { Transform: {}, Health: {}, StateMachineAgent: {} } },
    4: { name: 'Ground', components: { Transform: {} } },
  });

  it('answers the whole world when nothing is asked of it', () => {
    expect(findEntities(realm).total).toBe(4);
  });

  it('filters by component', () => {
    expect(findEntities(realm, { component: 'StateMachineAgent' }).entities.map((e) => e.entity))
      .toEqual([2, 3]);
  });

  it('filters by name, case-insensitively and by part', () => {
    expect(findEntities(realm, { name: 'skeleton' }).total).toBe(2);
  });

  it('takes both at once', () => {
    expect(findEntities(realm, { component: 'Health', name: 'player' }).entities).toHaveLength(1);
  });

  it('says what each one carries, so the next call is inspect and not a guess', () => {
    expect(findEntities(realm, { name: 'Player' }).entities[0].components).toEqual(['Transform', 'Health']);
  });

  // A capped list read as the whole world is how a search concludes something
  // is not there. The count is of every match; the list is what fitted.
  it('counts every match even when it can only carry some', () => {
    const out = findEntities(realm, { limit: 2 });
    expect(out.total).toBe(4);
    expect(out.entities).toHaveLength(2);
    expect(out.truncatedAt).toBe(2);
  });

  it('says nothing about truncation when nothing was truncated', () => {
    expect(findEntities(realm)).not.toHaveProperty('truncatedAt');
  });

  it('answers an empty world with a zero, not a throw', () => {
    expect(findEntities(fakeRealm({}))).toEqual({ total: 0, entities: [] });
  });
});

describe('the state that belongs to no entity', () => {
  it('answers with every resource at once, so no name has to be guessed', () => {
    const realm = fakeRealm({}, {
      resources: () => [['GameState', { lives: 3 }], ['Time', { frameCount: 90 }]],
    });
    expect(readResources(realm)).toEqual({
      resources: { GameState: { lives: 3 }, Time: { frameCount: 90 } },
    });
  });

  it('drops one whose name did not survive, rather than keying on an empty string', () => {
    const realm = fakeRealm({}, { resources: () => [['', { x: 1 }], ['Score', { n: 2 }]] });
    expect(Object.keys(readResources(realm).resources)).toEqual(['Score']);
  });
});

describe('what runs each frame', () => {
  it('lists systems and phases worst first', () => {
    const realm = fakeRealm({}, {
      timings: () => ({
        systems: new Map([['Render', 2], ['Physics', 9], ['AI', 4]]),
        phases: new Map([['Update', 13]]),
      }),
    });
    expect(readSystems(realm).systems?.map((r) => r.name)).toEqual(['Physics', 'AI', 'Render']);
    expect(readSystems(realm).phases).toEqual([{ name: 'Update', ms: 13 }]);
  });

  // "Nothing ran" and "nobody was counting" are opposite answers, and an empty
  // list reads as the first.
  it('answers null with a reason when nothing is recording', () => {
    const realm = fakeRealm({}, { timings: () => ({ systems: null, phases: null }) });
    const out = readSystems(realm);
    expect(out.systems).toBeNull();
    expect(out.note).toMatch(/not being recorded/);
  });

  it('says nothing extra when it IS recording', () => {
    const realm = fakeRealm({}, { timings: () => ({ systems: new Map(), phases: new Map() }) });
    expect(readSystems(realm)).not.toHaveProperty('note');
  });
});

describe('a value too large to send', () => {
  // Cut at a byte offset by the transport, a caller is left holding half a JSON
  // document with no way to tell which field went missing. Cut per value, and
  // the one that was cut is the one that says so.
  it('stands in for the big one and leaves its neighbours whole', () => {
    const realm = fakeRealm({
      1: {
        name: 'Level',
        components: {
          Transform: { x: 1 },
          TilemapLayer: { tiles: Array.from({ length: MAX_VALUE_JSON }, (_, i) => i) },
        },
      },
    });
    const components = inspectEntity(realm, 1).components;
    expect(components.Transform).toEqual({ x: 1 });
    expect(components.TilemapLayer).toMatchObject({ truncated: true, keys: ['tiles'] });
  });

  it('leaves anything that fits exactly as it was', () => {
    expect(bounded({ x: 1 })).toEqual({ x: 1 });
  });

  it('says so rather than throwing on something that will not serialise', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(bounded(cyclic)).toEqual({ unserializable: true });
  });
});
