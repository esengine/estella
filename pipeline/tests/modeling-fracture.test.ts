// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * A solid cut into the pieces it breaks into, held to what can be counted: the pieces fill the solid exactly, each is
 * closed, they are the same pieces from the same seed, and they are smaller where the blow lands.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { bakeModel, needsPreparing, prepareModeling, validateModelSource, type BakedModel, type ModelStep } from '../src/modeling';
import { collectEdges } from '../src/modeling/polyMesh';

beforeAll(() => prepareModeling());

const model = (...steps: ModelStep[]): BakedModel => bakeModel({ version: 1, steps });
const block: ModelStep = { op: 'box', size: [2, 2, 2], tag: 'stone', color: [0.8, 0.7, 0.6] };
const sum = (values: number[]): number => values.reduce((a, b) => a + b, 0);

describe('fracture', () => {
    it('cuts a solid into pieces that fill it exactly, each one closed', () => {
        const m = model(block, { op: 'fracture', pieces: 12, seed: 3 });
        const shards = m.shards!;
        expect(shards.length).toBeGreaterThanOrEqual(8);
        expect(shards.length).toBeLessThanOrEqual(12);
        expect(m.report.pieces).toBe(shards.length);
        // Together they are the eight cubic units the block was, and no piece is nothing.
        expect(sum(shards.map((s) => s.volume))).toBeCloseTo(8, 3);
        for (const s of shards) expect(s.volume).toBeGreaterThan(1e-4);
        // What is drawn until it breaks is the block as it was: one shell, twelve triangles, the size it was.
        expect(m.report.shells).toBe(1);
        expect(m.report.triangles).toBe(12);
        expect(m.report.openEdges).toBe(0);
        expect(m.report.insideOutShells).toBe(0);
        expect(m.report.bounds.size).toEqual([2, 2, 2]);
        for (let k = 0; k < shards.length; k++) {
            const faces = m.cut!.poly.faces.filter((f) => f.piece === k);
            const edges = [...collectEdges({ positions: m.cut!.poly.positions, faces }).values()];
            expect(edges.every((e) => e.faces.length === 2), `piece ${k} is closed`).toBe(true);
        }
        // All twelve came out, so there is nothing to say; fewer would be said.
        expect(m.report.warnings.filter((w) => !/pieces of the 12 asked/.test(w))).toEqual([]);
    });

    it('keeps the skin as it was and tags what a cut laid bare', () => {
        const m = model(block, { op: 'fracture', pieces: 8, seed: 2 });
        const [skin, inside] = [m.cut!.poly.faces.filter((f) => f.tag === 'stone'), m.cut!.poly.faces.filter((f) => f.tag === 'inside')];
        expect(skin.length + inside.length).toBe(m.cut!.poly.faces.length);
        expect(inside.length).toBeGreaterThan(0);
        // The skin keeps its colour; the inside is the same stone, darker.
        expect(skin.every((f) => f.color![0] === 0.8)).toBe(true);
        expect(inside.every((f) => Math.abs(f.color![0] - 0.48) < 1e-9)).toBe(true);
        // Every face of the skin lies on the block's own surface; no face of the inside lies wholly on it.
        const onSurface = (f: { v: number[] }): boolean => [0, 1, 2].some((axis) => [-1, 1].some((side) => f.v.every((v) => Math.abs(m.cut!.poly.positions[v]![axis]! - side) < 1e-5)));
        expect(skin.every(onSurface)).toBe(true);
        expect(inside.some(onSurface)).toBe(false);
        // Named and coloured where the source says.
        const named = model(block, { op: 'fracture', pieces: 4, seed: 2, tag: 'core', color: [1, 0, 0] });
        expect(named.cut!.poly.faces.filter((f) => f.tag === 'core').length).toBeGreaterThan(0);
        expect(named.cut!.poly.faces.find((f) => f.tag === 'core')!.color).toEqual([1, 0, 0, 1]);
    });

    it('writes each piece about its own middle, and says where that middle is', () => {
        const m = model(block, { op: 'fracture', pieces: 6, seed: 5 });
        for (const s of m.shards!) {
            // Inside the block, and no larger than it.
            for (const axis of [0, 1, 2]) {
                expect(Math.abs(s.center[axis]!)).toBeLessThanOrEqual(1);
                expect(s.size[axis]!).toBeLessThanOrEqual(2 + 1e-6);
            }
            expect(s.data.vertexCount).toBeGreaterThan(3);
            expect(s.data.indices.length % 3).toBe(0);
            expect(s.data.indices.length).toBeGreaterThan(0);
        }
        // The middles are not all one place.
        expect(new Set(m.shards!.map((s) => s.center.join())).size).toBe(m.shards!.length);
    });

    it('is the same pieces from the same seed, and other pieces from another', () => {
        const centres = (seed: number): string => model(block, { op: 'fracture', pieces: 8, seed }).shards!.map((s) => s.center.join()).join('|');
        expect(centres(4)).toBe(centres(4));
        expect(centres(4)).not.toBe(centres(5));
    });

    it('breaks small where it is struck and large far from it', () => {
        const struck = model(block, { op: 'fracture', pieces: 24, seed: 7, at: [1, 1, 1], focus: 1 }).shards!;
        const far = (s: { center: readonly number[] }): number => Math.hypot(s.center[0]! - 1, s.center[1]! - 1, s.center[2]! - 1);
        const near = struck.filter((s) => far(s) < 1.2).map((s) => s.volume);
        const rest = struck.filter((s) => far(s) >= 1.2).map((s) => s.volume);
        expect(near.length).toBeGreaterThan(3);
        expect(rest.length).toBeGreaterThan(0);
        expect(sum(near) / near.length).toBeLessThan((sum(rest) / rest.length) * 0.5);
        expect(sum(struck.map((s) => s.volume))).toBeCloseTo(8, 3);
    });

    it('fills a solid that is not a box: one with a hole through it', () => {
        const m = model(
            { op: 'box', size: [4, 3, 0.5], tag: 'wall' }, { op: 'box', size: [1, 1, 2], tag: 'cutter' },
            { op: 'boolean', operation: 'subtract', with: 'cutter', from: 'wall' },
            { op: 'fracture', pieces: 10, seed: 1 },
        );
        expect(sum(m.shards!.map((s) => s.volume))).toBeCloseTo(6 - 0.5, 3);
        expect(m.report.openEdges).toBe(0);
    });

    it('breaks a hollow thing into as many pieces as asked, struck or not', () => {
        // A thin-walled pot: most of its bounds are air, inside it and round it, where a point owns none of it.
        const pot = { op: 'lathe', sides: 16, profile: [[0, 0], [0.5, 0], [0.8, 1], [0.5, 1.9], [0.42, 1.9], [0.7, 1], [0.42, 0.1], [0, 0.1]] } as ModelStep;
        for (const [pieces, focus] of [[5, 0], [5, 0.5], [12, 0.8]] as const) {
            const m = model(pot, { op: 'fracture', pieces, seed: 4, at: [0.8, 1, 0], focus });
            expect(m.shards).toHaveLength(pieces);
            expect(m.report.warnings.join()).not.toMatch(/pieces of the/);
            expect(m.report.openEdges).toBe(0);
        }
    });

    it('breaks one part of a model and leaves the rest whole, and says so', () => {
        const m = model(block, { op: 'box', size: [4, 0.2, 4], at: [0, -1.1, 0], tag: 'plinth' }, { op: 'fracture', faces: 'stone', pieces: 6, seed: 2 });
        expect(m.cut!.poly.faces.filter((f) => f.tag === 'plinth').every((f) => f.piece === undefined)).toBe(true);
        expect(sum(m.shards!.map((s) => s.volume))).toBeCloseTo(8, 3);
        expect(m.report.warnings.join()).toMatch(/some faces are of no piece/);
    });

    it('leaves no sliver: a piece too small to see is given to its neighbours, and the solid is still filled', () => {
        // Crowded hard into one corner, some points would own almost nothing.
        const m = model(block, { op: 'fracture', pieces: 40, seed: 11, at: [1, 1, 1], focus: 1 });
        const volumes = m.shards!.map((s) => s.volume);
        const mean = sum(volumes) / volumes.length;
        expect(Math.min(...volumes)).toBeGreaterThan(mean * 0.03);
        expect(sum(volumes)).toBeCloseTo(8, 3);
    });

    it('has to be the last step, since what follows would change the pieces and not the model', () => {
        expect(() => model(block, { op: 'fracture', pieces: 4 }, { op: 'box', size: 1, at: [5, 0, 0] })).toThrow(/fracture has to be the last step/);
    });

    it('refuses what cannot be broken, and says why', () => {
        expect(() => model({ op: 'plane', size: [2, 2] }, { op: 'fracture', pieces: 4 })).toThrow(/what is to be broken is not a closed solid: they have 4 open edges/);
        expect(() => model(block, { op: 'fracture', pieces: 1 })).toThrow(/pieces must be a whole number, 2\.\.64/);
        expect(() => model(block, { op: 'fracture', pieces: 4 }, { op: 'fracture', pieces: 4 })).toThrow(/already in pieces: fracture once/);
        expect(() => model(block, { op: 'fracture', pieces: 4, faces: 'nothing' })).toThrow(/matched no face/);
        expect(() => validateModelSource({ version: 1, steps: [block, { op: 'fracture' }] })).toThrow(/pieces/);
        expect(needsPreparing([{ op: 'fracture' }])).toBe(true);
    });
});
