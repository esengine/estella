// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team

// The native submit seam carries every argument the engine entry point takes.
// The far side is generated from the C++ signature and opens `if (argc < 11)
// return`, so a seam one argument short draws nothing and says nothing.
import { describe, it, expect } from 'vitest';
import { submitTextBatch, setNativeTextSubmit, TEXT_VERTEX_FLOATS } from '../src/ui/text/submit';

function capture() {
    const calls: unknown[][] = [];
    setNativeTextSubmit((...args: unknown[]) => { calls.push(args); });
    return calls;
}

const vertices = new Float32Array(TEXT_VERTEX_FLOATS * 4);
const indices = new Uint16Array([0, 1, 2, 0, 2, 3]);
const transform = new Float32Array(16);

describe('the native text submit seam', () => {
    it('passes cullBit on, so the host binding sees a full argument list', () => {
        const calls = capture();
        submitTextBatch(null, vertices, indices, 7, transform, 42, 3, 0.5, true, 0b1010);
        setNativeTextSubmit(null);

        expect(calls).toHaveLength(1);
        // vertices, vertexCount, indices, textureId, transform, entity, layer, depth, sdf, cullBit
        expect(calls[0]).toHaveLength(10);
        expect(calls[0][9]).toBe(0b1010);
    });

    it('defaults cullBit rather than dropping the argument', () => {
        const calls = capture();
        submitTextBatch(null, vertices, indices, 7, transform, 42, 3, 0.5, false);
        setNativeTextSubmit(null);

        expect(calls[0]).toHaveLength(10);
        expect(calls[0][9]).toBe(0);
    });

    it('says nothing for a batch with no geometry', () => {
        const calls = capture();
        submitTextBatch(null, new Float32Array(0), indices, 7, transform, 42, 3, 0.5, true);
        submitTextBatch(null, vertices, new Uint16Array(0), 7, transform, 42, 3, 0.5, true);
        setNativeTextSubmit(null);

        expect(calls).toHaveLength(0);
    });
});
