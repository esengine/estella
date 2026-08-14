// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Which systems' order was never decided, read off what they declare.
 *        Two systems that touch the same data with no edge between them run in
 *        whatever order registration produced.
 */
import { describe, it, expect } from 'vitest';
import { App } from '../src/app/app';
import { Schedule, defineSystem } from '../src/ecs/system';
import type { SystemTouches } from '../src/index';
import { Query, Mut } from '../src/ecs/query';
import { Res, ResMut, defineResource } from '../src/ecs/resource';
import { defineComponent } from '../src/ecs/component';
import { GetWorld } from '../src/ecs/system';

const Position = defineComponent('AmbigPosition', { x: 0, y: 0 });
const Velocity = defineComponent('AmbigVelocity', { x: 0, y: 0 });
const Health = defineComponent('AmbigHealth', { hp: 100 });

const ScoreRes = defineResource({ value: 0 }, 'Score');

const noop = (): void => { };

describe('scheduleAmbiguities', () => {
    it('says nothing about systems that touch different components', () => {
        const app = App.new();
        app.addSystemToSchedule(Schedule.Update,
            defineSystem([Query(Mut(Position))], noop, { name: 'MovePos' }));
        app.addSystemToSchedule(Schedule.Update,
            defineSystem([Query(Mut(Health))], noop, { name: 'Regen' }));
        expect(app.scheduleAmbiguities(Schedule.Update)).toEqual([]);
    });

    it('names a pair where one writes what the other reads', () => {
        const app = App.new();
        app.addSystemToSchedule(Schedule.Update,
            defineSystem([Query(Mut(Position), Velocity)], noop, { name: 'Move' }));
        app.addSystemToSchedule(Schedule.Update,
            defineSystem([Query(Position)], noop, { name: 'Cull' }));
        const found = app.scheduleAmbiguities(Schedule.Update);
        expect(found).toHaveLength(1);
        expect(found[0]).toMatchObject({ a: 'Move', b: 'Cull', over: ['AmbigPosition'] });
    });

    it('stays quiet once the pair is ordered', () => {
        const app = App.new();
        app.addSystemToSchedule(Schedule.Update,
            defineSystem([Query(Mut(Position))], noop, { name: 'Move' }));
        app.addSystemToSchedule(Schedule.Update,
            defineSystem([Query(Position)], noop, { name: 'Cull' }), { runAfter: ['Move'] });
        expect(app.scheduleAmbiguities(Schedule.Update)).toEqual([]);
    });

    it('counts an order that only holds transitively', () => {
        const app = App.new();
        app.addSystemToSchedule(Schedule.Update,
            defineSystem([Query(Mut(Position))], noop, { name: 'A' }));
        app.addSystemToSchedule(Schedule.Update,
            defineSystem([Query(Mut(Velocity))], noop, { name: 'B' }), { runAfter: ['A'] });
        app.addSystemToSchedule(Schedule.Update,
            defineSystem([Query(Position)], noop, { name: 'C' }), { runAfter: ['B'] });
        expect(app.scheduleAmbiguities(Schedule.Update)).toEqual([]);
    });

    it('sees a resource written by one and read by another', () => {
        const app = App.new();
        app.addSystemToSchedule(Schedule.Update,
            defineSystem([ResMut(ScoreRes)], noop, { name: 'Award' }));
        app.addSystemToSchedule(Schedule.Update,
            defineSystem([Res(ScoreRes)], noop, { name: 'ShowScore' }));
        expect(app.scheduleAmbiguities(Schedule.Update).map((x) => x.over)).toEqual([['Score']]);
    });

    it('two readers of the same data are not ambiguous', () => {
        const app = App.new();
        app.addSystemToSchedule(Schedule.Update,
            defineSystem([Query(Position)], noop, { name: 'DrawA' }));
        app.addSystemToSchedule(Schedule.Update,
            defineSystem([Query(Position)], noop, { name: 'DrawB' }));
        expect(app.scheduleAmbiguities(Schedule.Update)).toEqual([]);
    });

    it('treats a system that takes the World as touching everything', () => {
        const app = App.new();
        app.addSystemToSchedule(Schedule.Update,
            defineSystem([GetWorld()], noop, { name: 'Escape' }));
        app.addSystemToSchedule(Schedule.Update,
            defineSystem([Query(Health)], noop, { name: 'Read' }));
        expect(app.scheduleAmbiguities(Schedule.Update)[0].over).toEqual(['the World itself']);
    });

    it('reads a with()/without() filter as data the system depends on', () => {
        const app = App.new();
        app.addSystemToSchedule(Schedule.Update,
            defineSystem([Query(Mut(Health))], noop, { name: 'Damage' }));
        app.addSystemToSchedule(Schedule.Update,
            defineSystem([Query(Position).with(Health)], noop, { name: 'DrawLiving' }));
        expect(app.scheduleAmbiguities(Schedule.Update)[0].over).toEqual(['AmbigHealth']);
    });

    it('takes a declared reach through the World over assuming everything', () => {
        const app = App.new();
        const touches: SystemTouches = { reads: ['AmbigVelocity'] };
        app.addSystemToSchedule(Schedule.Update,
            defineSystem([GetWorld()], noop, { name: 'Declared', touches }));
        app.addSystemToSchedule(Schedule.Update,
            defineSystem([Query(Mut(Health))], noop, { name: 'Damage' }));
        expect(app.scheduleAmbiguities(Schedule.Update)).toEqual([]);
    });

    it('still catches a declared reach that collides', () => {
        const app = App.new();
        app.addSystemToSchedule(Schedule.Update, defineSystem([GetWorld()], noop, {
            name: 'Declared',
            touches: { writes: ['AmbigHealth'] },
        }));
        app.addSystemToSchedule(Schedule.Update,
            defineSystem([Query(Health)], noop, { name: 'Draw' }));
        expect(app.scheduleAmbiguities(Schedule.Update)[0].over).toEqual(['AmbigHealth']);
    });
});

describe('scheduleBatches', () => {
    it('puts systems that touch nothing in common in one batch', () => {
        const app = App.new();
        app.addSystemToSchedule(Schedule.Update,
            defineSystem([Query(Mut(Position))], noop, { name: 'A' }));
        app.addSystemToSchedule(Schedule.Update,
            defineSystem([Query(Mut(Health))], noop, { name: 'B' }));
        expect(app.scheduleBatches(Schedule.Update)).toEqual([['A', 'B']]);
    });

    it('splits a batch where one system writes what the next reads', () => {
        const app = App.new();
        app.addSystemToSchedule(Schedule.Update,
            defineSystem([Query(Mut(Position))], noop, { name: 'Move' }));
        app.addSystemToSchedule(Schedule.Update,
            defineSystem([Query(Position)], noop, { name: 'Cull' }));
        expect(app.scheduleBatches(Schedule.Update)).toEqual([['Move'], ['Cull']]);
    });

    it('keeps a declared order across batches', () => {
        const app = App.new();
        app.addSystemToSchedule(Schedule.Update,
            defineSystem([Query(Mut(Position))], noop, { name: 'First' }));
        app.addSystemToSchedule(Schedule.Update,
            defineSystem([Query(Mut(Health))], noop, { name: 'Second' }), { runAfter: ['First'] });
        expect(app.scheduleBatches(Schedule.Update)).toEqual([['First'], ['Second']]);
    });
});
