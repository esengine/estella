/**
 * @file    ptr-bounds.test.ts
 * @brief   BuiltinBridge pointer helpers reject out-of-bounds access.
 */
import { describe, expect, it } from 'vitest';
import { fillPtrFields, readPtrField, writePtrField } from '../src/ecs/BuiltinBridge';

function makeHeap(size = 64) {
    const buffer = new ArrayBuffer(size);
    return {
        f32: new Float32Array(buffer),
        u32: new Uint32Array(buffer),
        u8: new Uint8Array(buffer),
    };
}

describe('WASM pointer bounds', () => {
    it('readPtrField reads within bounds', () => {
        const { f32, u32, u8 } = makeHeap(32);
        f32[5] = 42.5;
        expect(readPtrField(f32, u32, u8, 20, { name: 'x', type: 'f32', offset: 0 })).toBeCloseTo(42.5);
    });

    it('readPtrField throws on out-of-bounds offset', () => {
        const { f32, u32, u8 } = makeHeap(32);
        expect(() => readPtrField(f32, u32, u8, 28, { name: 'v', type: 'vec2', offset: 0 }))
            .toThrow(/out of bounds/i);
    });

    it('writePtrField throws on out-of-bounds offset', () => {
        const { f32, u32, u8 } = makeHeap(32);
        expect(() => writePtrField(f32, u32, u8, 28, { name: 'v', type: 'vec4', offset: 0 }, { x: 1, y: 2, z: 3, w: 4 }))
            .toThrow(/out of bounds/i);
    });

    it('fillPtrFields throws when the struct spans past the heap', () => {
        const { f32, u32, u8 } = makeHeap(32);
        const fields = [
            { name: 'a', type: 'f32' as const, offset: 0 },
            { name: 'v', type: 'vec4' as const, offset: 20 },  // 20 + 16 = 36 > 32
        ];
        expect(() => fillPtrFields(f32, u32, u8, 0, fields, {}))
            .toThrow(/out of bounds/i);
    });

    it('fillPtrFields succeeds when every field fits', () => {
        const { f32, u32, u8 } = makeHeap(64);
        const fields = [
            { name: 'a', type: 'f32' as const, offset: 0 },
            { name: 'v', type: 'vec4' as const, offset: 16 },
        ];
        f32[0] = 1; f32[4] = 2; f32[5] = 3; f32[6] = 4; f32[7] = 5;
        const out: Record<string, unknown> = { v: { x: 0, y: 0, z: 0, w: 0 } };
        fillPtrFields(f32, u32, u8, 0, fields, out);
        expect(out.a).toBeCloseTo(1);
        expect(out.v).toMatchObject({ x: 2, y: 3, z: 4, w: 5 });
    });

    it('rejects negative offsets', () => {
        const { f32, u32, u8 } = makeHeap(32);
        expect(() => readPtrField(f32, u32, u8, -4, { name: 'x', type: 'f32', offset: 0 }))
            .toThrow(/out of bounds/i);
    });
});
