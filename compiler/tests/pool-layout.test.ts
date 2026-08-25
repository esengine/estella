// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    pool-layout.test.ts
 * @brief   The engine's rows and the compiler's offsets are one layout.
 *
 * @details A compiled system loads a script component's field at the offset this
 *          compiler emitted. The engine writes it at the offset `ScriptPool`
 *          chose. Those are two authors for one number, and the way that ends is
 *          a read of a different field — the same failure EHT's table exists to
 *          prevent for engine components.
 *
 *          So this holds them together over a real `defineComponent` shape. It
 *          is the script-side counterpart of the `offsetof` checks in
 *          tests/aot/test_aot_host.cpp.
 */
import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { lowerProgram } from '../src/frontend';
import { builtinShapes } from '../src/builtins';
import { packLayout } from '../src/abi';
import { encBytes } from '../src/eir';
import { ScriptPool, poolShape, POOL_SLOT_BYTES } from '../../sdk/src/ecs/ScriptPool';

const FIXTURE = resolve(fileURLToPath(new URL('./fixtures/in-subset.ts', import.meta.url)));

/** The literal `defineComponent` passes, as the SDK holds it in `_default`. */
const DRIFT_DEFAULTS = { rate: 40, wrap: 100, enabled: true };

const { module } = lowerProgram([FIXTURE], builtinShapes());
const layout = packLayout(module.comps);

describe('a script component has one layout, not two', () => {
    it('the compiler and the pool agree field by field', () => {
        const shape = layout.comps.get('FixtureDrift');
        expect(shape, 'the fixture stopped declaring FixtureDrift').toBeDefined();
        const pool = new ScriptPool(poolShape(DRIFT_DEFAULTS)!);

        expect(pool.stride).toBe(shape!.stride);
        pool.fields.forEach((f, i) => {
            const leaf = shape!.leaves.get(f.name);
            expect(leaf, `the compiler has no field '${f.name}'`).toBeDefined();
            expect(leaf!.byteOffset, `'${f.name}' sits in two places`).toBe(i * POOL_SLOT_BYTES);
            // A host record is f64 throughout, which is what makes one slot per
            // field the whole story.
            expect(encBytes(leaf!.enc)).toBe(POOL_SLOT_BYTES);
        });
    });

    it('and on the field ORDER, which is what a slot index means', () => {
        // Declaration order is the only thing tying slot 1 to `wrap`. If the two
        // sides ever sort differently, every field still exists and every one is
        // the wrong one.
        expect(new ScriptPool(poolShape(DRIFT_DEFAULTS)!).fields.map((f) => f.name))
            .toEqual([...layout.comps.get('FixtureDrift')!.leaves.keys()]);
    });

    it('a shape the pool refuses is a shape the compiler refuses', () => {
        // Both sides admit exactly the all-scalar shapes, and they have to: a
        // component the compiler lowers but the engine cannot lay out flat is a
        // system that compiles and then has nowhere to read from.
        expect(poolShape({ label: 'hi' })).toBeNull();
        expect(module.comps.get('FixtureDrift')!.storage).toBe('host');
        for (const [, spec] of module.comps.get('FixtureDrift')!.fields) {
            expect(spec.enc).toBe('f64');
            expect(spec.offset, 'a host record is laid out by the ABI, not by EHT').toBeNull();
        }
    });
});
