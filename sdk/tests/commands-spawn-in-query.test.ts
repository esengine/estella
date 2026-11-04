// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * `cmds.spawn(...).id()` inside a query loop: the id is reserved on the spot and
 * the spawn lands when the commands flush, instead of throwing "Cannot spawn
 * entity during query iteration".
 */
import { describe, it, expect } from 'vitest';
import { App } from '../src/app/app';
import { defineSystem } from '../src/ecs/system';
import { Query } from '../src/ecs/query';
import { Commands } from '../src/ecs/commands';
import { defineComponent } from '../src/ecs/component';
import type { Entity } from '../src/types';

describe('Commands.spawn().id() during a query', () => {
    it('reserves the id and spawns into it at flush', async () => {
        const Source = defineComponent('SpawnInQuerySource', { n: 0 });
        const Child = defineComponent('SpawnInQueryChild', { of: 0 });
        const app = App.new();
        const a = app.world.spawn(); app.world.insert(a, Source, { n: 1 });
        const b = app.world.spawn(); app.world.insert(b, Source, { n: 2 });
        const made: Entity[] = [];
        app.addSystem(defineSystem([Query(Source), Commands()], (q, cmds) => {
            for (const [entity] of q) {
                const id = cmds.spawn('child').insert(Child, { of: entity as number }).id();
                expect(id).not.toBe(0);
                made.push(id);
            }
        }, { name: 'SpawnInQuery' }));
        await app.tick(1 / 60);
        expect(made).toHaveLength(2);
        expect(new Set(made).size).toBe(2);
        for (const id of made) {
            expect(app.world.valid(id)).toBe(true);
            expect(app.world.has(id, Child)).toBe(true);
        }
        expect(made.map((id) => app.world.get(id, Child).of).sort()).toEqual([a, b].map(Number).sort());
    });
});
