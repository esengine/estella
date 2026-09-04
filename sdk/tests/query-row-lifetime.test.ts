// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  How long a value read out of a query stays valid.
 *
 * Engine-backed components are read through a pointer accessor that fills a
 * preallocated object, so the row a query yields can be a BORROWED view of the
 * next row's memory. That is a read-correctness question and has nothing to do
 * with whether writing to a row is allowed: `toArray()` returning three rows
 * that are one object is wrong even for a reader that never writes.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { App } from '../src/app/app';
import { Query, QueryInstance } from '../src/ecs/query';
import { Transform } from '../src/ecs/component';
import type { World } from '../src/ecs/world';
import type { ESEngineModule, CppRegistry } from '../src/wasm';
import { loadWasmModule, HAS_WASM } from './helpers/loadWasm';

const X = [100, 200, 300];

describe.skipIf(!HAS_WASM)('query row lifetime', () => {
    let module: ESEngineModule;
    beforeAll(async () => { module = await loadWasmModule(); });

    /** A world holding three entities whose Transforms differ in x. */
    function worldOfThree(): { app: App; world: World } {
        const app = App.new();
        app.connectCpp(new module.Registry() as unknown as CppRegistry, module);
        const world = app.world;
        for (const x of X) world.insert(world.spawn(), Transform, { position: { x, y: 0, z: 0 } });
        return { app, world };
    }

    type Row = [number, { position: { x: number } }];
    type Rows = Iterable<Row> & {
        toArray(): Row[];
        single(): Row;
        forEach(cb: (e: number, t: { position: { x: number } }) => void): void;
    };

    const rowsOf = (world: World): Rows =>
        new QueryInstance(world, Query(Transform)) as unknown as Rows;

    /** Run one body against a query over Transform. */
    function inQuery(fn: (q: Rows) => void): void {
        const { app, world } = worldOfThree();
        fn(rowsOf(world));
        app.world.disconnectCpp();
    }

    it('toArray keeps every row distinct', () => {
        inQuery((q) => {
            const rows = q.toArray();
            expect(rows.map((r) => r[1].position.x)).toEqual(X);
            expect(new Set(rows.map((r) => r[1])).size).toBe(3);
        });
    });

    it('a row held across iteration still reads its own entity', () => {
        inQuery((q) => {
            let first: { position: { x: number } } | undefined;
            for (const [, t] of q) if (!first) first = t;
            expect(first?.position.x).toBe(X[0]);
        });
    });

    it('single returns a value that outlives the query', () => {
        const { app, world } = worldOfThree();
        // The SAME instance must walk again: each QueryInstance resolves its own
        // scratch, so a second instance would not overwrite the first one's row
        // and the assertion would pass without the defect being fixed.
        const q = rowsOf(world);
        const held = (q as unknown as { single(): Row }).single()[1];
        for (const _row of q) { /* walk every row */ }
        expect(held.position.x).toBe(X[0]);
        app.world.disconnectCpp();
    });

    it('forEach lends its row for the duration of the callback only', () => {
        inQuery((q) => {
            const seen: number[] = [];
            q.forEach((_e, t) => { seen.push(t.position.x); });
            expect(seen).toEqual(X);
        });
    });
});
