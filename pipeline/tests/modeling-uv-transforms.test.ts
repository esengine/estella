// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { MeshChannel } from 'esengine';
import { bakeModel, type ModelStep } from '../src/modeling';

const leaf: ModelStep[] = [
    { op: 'plane', size: [20, 40], tag: 'leaf' },
    { op: 'uv', mode: 'planar', axis: '+y', scale: [20, 40], offset: [0.5, 0.5] },
];
function vertices(steps: ModelStep[]) {
    const { data } = bakeModel({ version: 1, steps });
    const at = (semantic: number) => data.channels.find((c) => c.semantic === semantic)!.offset;
    const view = new DataView(data.vertices.buffer, data.vertices.byteOffset, data.vertices.byteLength);
    return Array.from({ length: data.vertexCount }, (_, i) => ({
        p: [0, 1, 2].map((k) => view.getFloat32(i * data.vertexStride + at(MeshChannel.Position) + k * 4, true)),
        uv: [0, 1].map((k) => view.getFloat32(i * data.vertexStride + at(MeshChannel.TexCoord0) + k * 4, true)),
    }));
}
function fullTexture(v: ReturnType<typeof vertices>) {
    for (const axis of [0, 1]) {
        expect(Math.min(...v.map((p) => p.uv[axis]!))).toBeCloseTo(0, 5);
        expect(Math.max(...v.map((p) => p.uv[axis]!))).toBeCloseTo(1, 5);
    }
}
describe('authored UVs travel with leaves and other model parts', () => {
    it('keeps both texture axes after a translated, rotated and scaled leaf', () => {
        const v = vertices([...leaf, { op: 'transform', translate: [80, 200, 30], rotate: [90, 0, 0], scale: 2 }]);
        fullTexture(v);
        for (const c of v) {
            expect(c.uv[0]).toBeCloseTo((c.p[0]! - 80) / 40 + 0.5, 5);
            expect(c.uv[1]).toBeCloseTo((c.p[1]! - 200) / 80 + 0.5, 5);
        }
    });
    it('keeps the full texture on every rotated array and scattered copy', () => {
        fullTexture(vertices([...leaf, { op: 'array', count: 4, offset: [50, 20, 0], rotate: [30, 45, 0] }]));
        fullTexture(vertices([...leaf, { op: 'scatter', source: 'leaf', count: 12, within: [[50, 100, 50], [200, 300, 200]], scale: [0.6, 1.8], spin: 360, tilt: 50, seed: 5 }]));
    });
    it('mirrors geometry and texture together, including already frozen UVs', () => {
        const v = vertices([...leaf, { op: 'transform', translate: [30, 0, 0] }, { op: 'mirror', axis: 'x', at: 0, keep: false }]);
        fullTexture(v);
        for (const c of v) expect(c.uv[0]).toBeCloseTo((-c.p[0]! - 30) / 20 + 0.5, 5);
    });
    it('allows a later UV step to replace coordinates frozen by a transform', () => {
        const v = vertices([...leaf, { op: 'transform', rotate: [90, 0, 0] },
            { op: 'uv', mode: 'planar', axis: '+z', scale: [10, 20], offset: [0.5, 0.5] }]);
        for (const axis of [0, 1]) {
            expect(Math.min(...v.map((p) => p.uv[axis]!))).toBeCloseTo(-0.5, 5);
            expect(Math.max(...v.map((p) => p.uv[axis]!))).toBeCloseTo(1.5, 5);
        }
    });
});
