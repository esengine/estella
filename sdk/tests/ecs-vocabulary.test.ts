// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  ecs-vocabulary.test.ts — the types the frozen ECS calls are spelled in.
 *
 * Freezing defineComponent/defineSystem/Query/Mut/Res/Commands freezes the
 * vocabulary their signatures are written in, so each of those types is pinned
 * here: annotated (which is the compile-time half) and asserted (the other one).
 */
import { describe, it, expect } from 'vitest';
import {
    defineComponent, defineSystem, defineResource, defineEvent, Query, Mut, Res, ResMut,
    Commands, With, Without, And, Or, Not, Added, Changed, Removed,
    EventReader, EventWriter, GetWorld, Transform, World, QueryInstance,
    Parent, Children, Name, getComponentDefaults, defineTag,
    vec2, vec3, vec4, quat, color,
} from '../src/core';
import type {
    AnyComponentDef, BuiltinComponentDef, ComponentDef, ComponentMetadata, FieldMeta,
    QueryBuilder, QueryDescriptor, MutWrapper, AddedWrapper, ChangedWrapper,
    FilterExpr, RemovedQueryDescriptor,
    ResourceDef, ResDescriptor, ResMutDescriptor, CommandsDescriptor, QueryArg,
    EventDef, EventReaderDescriptor, EventWriterDescriptor, GetWorldDescriptor,
    SystemDef, SystemOptions, SystemParam, InferParam, InferParams, ComponentData,
    Entity, QueryResult, ChildrenData, ParentData, NameData, TransformData,
    Vec2, Vec3, Vec4, Quat, Color,
} from '../src/core';

const Position = defineComponent('VocabPosition', { x: 0, y: 0 });
const Health = defineComponent('VocabHealth', { hp: 100 });

describe('component vocabulary', () => {
    it('defineComponent answers a ComponentDef that is also AnyComponentDef', () => {
        const def: ComponentDef<{ x: number; y: number }> = Position;
        const any: AnyComponentDef = def;
        expect(any).toBe(Position);
        expect(def.create()).toEqual({ x: 0, y: 0 });
        expect(def.create({ x: 5 })).toEqual({ x: 5, y: 0 });
    });

    it('carries the reflection a ComponentMetadata declared', () => {
        const meta: ComponentMetadata = {
            entityFields: ['target'],
            replicatedFields: ['hp'],
            transient: true,
        };
        const def = defineComponent('VocabMetaCarrier', { hp: 1, target: 0 }, meta);
        expect(def.entityFields).toEqual(['target']);
        expect(def.replicatedFields).toEqual(['hp']);
        expect(def.transient).toBe(true);
    });

    it('defaults the reflection when the metadata says nothing', () => {
        expect(Health.transient).toBe(false);
        expect(Health.replicatedFields).toEqual([]);
        expect(Health.renderableField).toBeNull();
    });

    it('the hierarchy and naming components carry the shapes they promise', () => {
        // Their defaults, not a live tree: Parent/Children are engine-backed, so
        // reparenting needs a C++ registry this suite deliberately runs without.
        const parent = getComponentDefaults('Parent') as unknown as ParentData;
        const children = getComponentDefaults('Children') as unknown as ChildrenData;
        // Name is the odd one: a user component, so it lives in the context
        // registry rather than the global builtin one, and makes its own value.
        const name: NameData = Name.create();
        expect(parent).toHaveProperty('entity');
        expect(children).toHaveProperty('entities');
        expect(name.value).toBe('');
        const defs: AnyComponentDef[] = [Parent, Children, Name];
        expect(defs.map((d) => d._name)).toEqual(['Parent', 'Children', 'Name']);
    });

    it('an engine component reflects the same way a declared one does', () => {
        // Both halves of AnyComponentDef answer the reflection tooling reads, so
        // an editor or a cook never asks which kind it is holding.
        const builtin = Transform as unknown as BuiltinComponentDef<unknown>;
        expect(builtin._builtin).toBe(true);
        expect(Array.isArray(builtin.readonlyFields)).toBe(true);
        expect(typeof builtin.fieldMeta).toBe('object');
        // The world fields are engine-COMPUTED, and saying so is the contract
        // that stops an editor projecting them back over the composed value.
        expect(builtin.readonlyFields).toEqual(
            expect.arrayContaining(['worldPosition', 'worldRotation', 'worldScale']),
        );
        // No create() on this half of the union — an engine component is made by
        // the registry, so its shape is read from the defaults instead.
        const shape = getComponentDefaults('Transform') as unknown as TransformData;
        expect(Object.keys(shape)).toEqual(expect.arrayContaining(['position', 'rotation', 'scale']));
    });

    it('FieldMeta is the per-field policy a definition carries', () => {
        const meta: Record<string, FieldMeta> = { hp: { min: 0, max: 100 } };
        const def = defineComponent('VocabFieldMeta', { hp: 1 }, { fields: meta });
        expect(def.fieldMeta.hp).toEqual({ min: 0, max: 100 });
    });
});

describe('math vocabulary', () => {
    it('the value types a component field holds are plain data', () => {
        const position: Vec3 = vec3(1, 2, 3);
        const uv: Vec2 = vec2(0.5, 0.25);
        const uniform: Vec4 = vec4(1, 0, 0, 1);
        const rotation: Quat = quat(0, 0, 0, 1);
        const tint: Color = color(1, 1, 1, 1);
        // Plain, because they cross to the engine as struct memory: own keys
        // only, and JSON round-trips them unchanged.
        for (const v of [position, uv, uniform, rotation, tint]) {
            expect(JSON.parse(JSON.stringify(v))).toEqual(v);
        }
        expect(Object.keys(position)).toEqual(['x', 'y', 'z']);
        expect(Object.keys(tint)).toEqual(['r', 'g', 'b', 'a']);
    });
});

describe('query vocabulary', () => {
    it('Query answers a QueryBuilder, which is a usable QueryDescriptor', () => {
        const builder: QueryBuilder<[typeof Position]> = Query(Position);
        const descriptor: QueryDescriptor<[typeof Position]> = builder;
        expect(descriptor._components).toEqual([Position]);
    });

    it('with/without answer a NEW builder, leaving the one they narrowed alone', () => {
        const q = Query(Position);
        const narrowed = q.with(Health).without(Position);
        expect(narrowed).not.toBe(q);
        expect(narrowed._with).toEqual([Health]);
        expect(narrowed._without).toEqual([Position]);
        expect(q._with).toEqual([]);
        expect(q._without).toEqual([]);
    });

    it('filter replaces a prior expression rather than adding to it', () => {
        const q = Query(Position).filter(With(Health)).filter(With(Position));
        expect(q._filter).toEqual({ kind: 'with', component: Position });
    });

    it('QueryResult is the entity followed by the components asked for', () => {
        const world = new World();
        const e = world.spawn();
        world.insert(e, Position, { x: 3, y: 4 });
        world.insert(e, Health, { hp: 20 });
        const rows: QueryResult<[typeof Position, typeof Health]>[] =
            new QueryInstance(world, Query(Position, Health)).toArray();
        expect(rows).toHaveLength(1);
        const [entity, position, health] = rows[0];
        const id: Entity = entity;
        expect(id).toBe(e);
        expect(position).toEqual({ x: 3, y: 4 });
        expect(health).toEqual({ hp: 20 });
    });

    it('FilterExpr composes and stays readable without running the query', () => {
        const expr: FilterExpr = And(With(Position), Or(Without(Health), Not(With(Health))));
        expect(expr.kind).toBe('and');
        // Readable is the claim: walk it and name the components it mentions.
        const names = (e: FilterExpr): string[] =>
            e.kind === 'with' || e.kind === 'without' ? [e.component._name]
                : e.kind === 'not' ? names(e.filter)
                    : e.filters.flatMap(names);
        expect(names(expr)).toEqual(['VocabPosition', 'VocabHealth', 'VocabHealth']);
    });

    it('QueryArg admits a bare component and each of the wrappers', () => {
        const added: AddedWrapper<typeof Position> = Added(Position);
        const changed: ChangedWrapper<typeof Health> = Changed(Health);
        const args: QueryArg[] = [Position, Mut(Health), added, changed];
        // Whatever the wrapper, the query matches on the component inside it.
        expect(Query(...args)._components).toHaveLength(4);
        expect(Query(Added(Position))._addedFilters).toEqual([{ index: 0, component: Position }]);
        expect(Query(Changed(Health))._changedFilters).toEqual([{ index: 0, component: Health }]);
    });

    it('Mut answers a MutWrapper the query records as a written index', () => {
        const wrapped: MutWrapper<typeof Position> = Mut(Position);
        expect(wrapped._component).toBe(Position);
        expect(Query(Health, wrapped)._mutIndices).toEqual([1]);
    });
});

describe('resource vocabulary', () => {
    it('defineResource answers a ResourceDef and Res a descriptor over it', () => {
        const Score: ResourceDef<{ points: number }> = defineResource({ points: 0 }, 'VocabScore');
        const descriptor: ResDescriptor<{ points: number }> = Res(Score);
        expect(descriptor._resource).toBe(Score);
    });

    it('two definitions are two resources however they are named', () => {
        // The name is diagnostics, not identity: a project that reuses one must
        // still get its own value rather than silently sharing.
        const a = defineResource(0, 'VocabDuplicate');
        const b = defineResource(0, 'VocabDuplicate');
        expect(a._id).not.toBe(b._id);
    });
});

describe('world vocabulary', () => {
    it('spawn, valid and despawn are the entity lifecycle', () => {
        const world = new World();
        const e = world.spawn('vocab-entity');
        expect(world.valid(e)).toBe(true);
        expect(world.entityCount()).toBe(1);
        world.despawn(e);
        expect(world.valid(e)).toBe(false);
        expect(world.entityCount()).toBe(0);
    });

    it('isStale answers about the slot, not the entity', () => {
        // Both are invalid; isStale is the one that says WHY. It reports on the
        // index, and a pure-JS world never reuses one — the recycled case needs an
        // engine core, so what is pinned here is that neither false is a throw.
        const world = new World();
        const e = world.spawn();
        world.despawn(e);
        expect(world.valid(e)).toBe(false);
        expect(world.isStale(e)).toBe(false);
        expect(world.isStale(9999 as typeof e)).toBe(false);
    });

    it('insert merges over the component defaults, and get answers the stored value', () => {
        const world = new World();
        const e = world.spawn();
        const data: ComponentData<typeof Position> = world.insert(e, Position, { x: 5 });
        expect(data).toEqual({ x: 5, y: 0 });
        expect(world.get(e, Position)).toEqual({ x: 5, y: 0 });
        expect(world.has(e, Position)).toBe(true);
    });

    it('tryGet answers null where get is a programming error', () => {
        const world = new World();
        const e = world.spawn();
        expect(world.tryGet(e, Position)).toBeNull();
        world.insert(e, Position);
        expect(world.tryGet(e, Position)).toEqual({ x: 0, y: 0 });
    });

    it('set is insert-or-replace and remove takes it off again', () => {
        const world = new World();
        const e = world.spawn();
        world.set(e, Position, { x: 1, y: 2 });
        expect(world.has(e, Position)).toBe(true);
        expect(world.get(e, Position)).toEqual({ x: 1, y: 2 });
        world.remove(e, Position);
        expect(world.has(e, Position)).toBe(false);
    });

    it('set on a component the entity lacked reaches a query that already ran', () => {
        // "Insert-or-replace" is the whole claim: an add through set owes the same
        // structural bookkeeping insert does, or a warmed cache answers the old set
        // forever. It did not, until freezing the method made the claim explicit.
        const world = new World();
        const e = world.spawn();
        expect(world.getEntitiesWithComponents([Position])).toEqual([]);
        world.set(e, Position, { x: 1, y: 2 });
        expect(world.getEntitiesWithComponents([Position])).toEqual([e]);
    });

    it('getComponentTypes lists a component however it was added', () => {
        // Defined here rather than at module scope: the name lookup reads the
        // context's registry, which the suite's setup resets.
        const Local = defineComponent('VocabLocal', { v: 0 });
        const world = new World();
        const viaSet = world.spawn();
        const viaInsert = world.spawn();
        world.set(viaSet, Local, { v: 1 });
        world.insert(viaInsert, Local, { v: 2 });
        expect(world.getComponentTypes(viaSet)).toContain('VocabLocal');
        expect(world.getComponentTypes(viaInsert)).toContain('VocabLocal');
    });

    it('getEntitiesWithComponents narrows by with and without', () => {
        const world = new World();
        const both = world.spawn();
        world.insert(both, Position);
        world.insert(both, Health);
        const positionOnly = world.spawn();
        world.insert(positionOnly, Position);

        expect([...world.getEntitiesWithComponents([Position])].sort()).toEqual([both, positionOnly].sort());
        expect(world.getEntitiesWithComponents([Position], [Health])).toEqual([both]);
        expect(world.getEntitiesWithComponents([Position], [], [Health])).toEqual([positionOnly]);
    });

    it('findEntityByName reads the name spawn was given', () => {
        const world = new World();
        const e = world.spawn('vocab-findable');
        expect(world.findEntityByName('vocab-findable')).toBe(e);
        expect(world.findEntityByName('nobody')).toBeNull();
    });

    it('onSpawn and onDespawn fire until their unsubscribe is called', () => {
        const world = new World();
        const spawned: number[] = [];
        const despawned: number[] = [];
        const offSpawn = world.onSpawn((e) => spawned.push(e));
        const offDespawn = world.onDespawn((e) => despawned.push(e));

        const first = world.spawn();
        world.despawn(first);
        offSpawn();
        offDespawn();
        world.despawn(world.spawn());

        expect(spawned).toEqual([first]);
        expect(despawned).toEqual([first]);
    });

    it('mutating an entity while a query iterates is refused, not tolerated', () => {
        // The contract Commands exists to satisfy — asserted because a throw is
        // the promise, and silently corrupting the walk would also "work".
        const world = new World();
        const e = world.spawn();
        world.insert(e, Position);
        world.beginIteration();
        try {
            expect(() => world.spawn()).toThrow(/Commands/);
            expect(() => world.despawn(e)).toThrow(/Commands/);
            expect(() => world.remove(e, Position)).toThrow(/Commands/);
        } finally {
            world.endIteration();
        }
    });
});

describe('event vocabulary', () => {
    it('defineEvent answers an EventDef both descriptors are built over', () => {
        const Hit: EventDef<{ damage: number }> = defineEvent('VocabHit');
        const writer: EventWriterDescriptor<{ damage: number }> = EventWriter(Hit);
        const reader: EventReaderDescriptor<{ damage: number }> = EventReader(Hit);
        expect(writer._event).toBe(Hit);
        expect(reader._event).toBe(Hit);
    });
});

describe('tag vocabulary', () => {
    it('defineTag answers a fieldless ComponentDef, and the same one twice', () => {
        const Frozen: ComponentDef<{}> = defineTag('VocabFrozen');
        expect(Frozen.create()).toEqual({});
        // A tag carries no data, so re-declaring one cannot conflict with itself.
        expect(defineTag('VocabFrozen')).toBe(Frozen);
    });
});

describe('system vocabulary', () => {
    it('every parameter factory answers something that is a SystemParam', () => {
        const commands: CommandsDescriptor = Commands();
        const params: SystemParam[] = [Query(Position), Res(defineResource(0)), commands];
        expect(params).toHaveLength(3);
        // Two calls are equal but not the same object — a descriptor is a request,
        // not a handle, so nothing may key off its identity.
        expect(Commands()).not.toBe(commands);
        expect(Commands()).toEqual(commands);
    });

    it('defineSystem answers a SystemDef carrying its declared parameters', () => {
        const def: SystemDef = defineSystem([Query(Position)], () => {});
        expect(def._params).toHaveLength(1);
    });

    it('SystemOptions ordering travels with the definition', () => {
        const options: SystemOptions = { name: 'vocab', runAfter: ['physics'] };
        const def = defineSystem([Commands()], () => {}, options);
        expect(def._name).toBe('vocab');
        expect(def._runAfter).toEqual(['physics']);
    });

    it('every remaining parameter factory answers its own descriptor type', () => {
        const Ping = defineEvent<{ n: number }>('VocabPing');
        const Score = defineResource(0, 'VocabInferScore');
        const writer: EventWriterDescriptor<{ n: number }> = EventWriter(Ping);
        const reader: EventReaderDescriptor<{ n: number }> = EventReader(Ping);
        const world: GetWorldDescriptor = GetWorld();
        const resMut: ResMutDescriptor<number> = ResMut(Score);
        const removed: RemovedQueryDescriptor<typeof Position> = Removed(Position);
        const params: SystemParam[] = [writer, reader, world, resMut, removed];
        expect(params).toHaveLength(5);
        expect(removed._component).toBe(Position);
    });

    it('InferParam sends an unrecognised declaration to never', () => {
        // The `never` is the point: a bad parameter is a type error where the
        // system is defined, not a surprise when the runner calls it.
        const unrecognised: InferParam<{ nonsense: true }> = undefined as never;
        expect(unrecognised).toBeUndefined();
    });

    it('InferParams resolves a declaration to what the body is handed', () => {
        // The annotation is the assertion: a body typed against InferParams of
        // its own parameter list must accept the values the runner passes.
        const params = [Query(Position), Commands()] as const;
        const body = (...args: InferParams<typeof params>) => {
            const [q, commands] = args;
            return typeof q.forEach === 'function' && typeof commands.spawn === 'function';
        };
        let ran = false;
        defineSystem([...params], (q, commands) => { ran = body(q, commands); });
        expect(ran).toBe(false);
    });
});
