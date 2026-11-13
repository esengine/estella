// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * What a model's report says of its steps: one entry for each step as written, what each cost in triangles, and that a step which
 * takes back what a decimate left is named.
 */
import { describe, expect, it } from 'vitest';
import { applyModelEdits, bakeModel, validateModelSource, type ModelSource } from '../src/modeling';

describe('a model report\'s steps', () => {
    const tree: ModelSource = {
        version: 1,
        steps: [
            { id: 'trunk', op: 'cylinder', radius: 0.1, height: 2, sides: 6, at: [0, 1, 0] },
            { op: 'repeat', over: [{ y: 0.5, k: 3 }, { y: 1, k: 4 }, { y: 1.5, k: 2 }], steps: [
                { op: 'repeat', count: '=k', steps: [
                    { op: 'box', size: [0.4, 0.05, 0.1], at: '=polar(i * 360 / k, 0.3, y)' },
                ] },
            ] },
            { id: 'top', op: 'cone', radius: 0.1, height: 0.3, sides: 6, at: [0, 2.15, 0] },
        ] as ModelSource['steps'],
    };

    it('are the steps as written: a repeat is one, counted, and an index is what an edit names', () => {
        const { report } = bakeModel(tree);
        expect(report.steps.map((s) => [s.index, s.op, s.id, s.made])).toEqual([
            [0, 'cylinder', 'trunk', undefined],
            // Nine boxes, from three rows of three, four and two.
            [1, 'repeat', undefined, 9],
            [2, 'cone', 'top', undefined],
        ]);
        // The repeat's entry is the mesh as its last box left it.
        expect(report.steps[1]!.faces - report.steps[0]!.faces).toBe(9 * 6);
        expect(report.steps.at(-1)!.triangles).toBe(report.triangles);

        // And the index is the one an edit takes: the step it names is the step the report meant.
        const edited = applyModelEdits(validateModelSource(tree), [{ op: 'remove', step: report.steps[2]!.index }]);
        expect(edited.steps.map((s) => s.op)).toEqual(['cylinder', 'repeat']);
    });

    it('say what each step left in triangles', () => {
        const { report } = bakeModel({ version: 1, steps: [
            { op: 'sphere', radius: 1, rings: 12, sides: 16 },
            { id: 'thin', op: 'decimate', triangles: 120 },
        ] });
        expect(report.steps[0]!.triangles).toBeGreaterThan(300);
        expect(report.steps[1]).toMatchObject({ index: 1, id: 'thin', op: 'decimate', trianglesBefore: report.steps[0]!.triangles });
        expect(report.steps[1]!.triangles).toBe(report.steps[1]!.trianglesAfter);
    });

    it('name a step that splits what a decimate left, and say nothing of one that does not', () => {
        const rock = (after: ModelSource['steps']): string[] => bakeModel({ version: 1, steps: [
            { id: 'body', op: 'sphere', radius: 1, rings: 16, sides: 24, tag: 'rock' },
            { id: 'thin', op: 'decimate', triangles: 200 },
            ...after,
        ] as ModelSource['steps'] }).report.warnings;

        // A stain by a pattern is as fine as its pattern: it splits the faces the decimate kept.
        const said = rock([{ id: 'lichen', op: 'stain', faces: 'rock', color: [0.3, 0.4, 0.2], pattern: 'bumps', scale: 0.12 }]);
        const warning = said.find((w) => w.includes('lichen'));
        expect(warning).toBeDefined();
        expect(warning).toMatch(/split the \d+ triangles it was given into \d+/);
        expect(warning).toContain('"thin"');
        expect(warning).toContain('before the decimate');
        expect(warning).toContain('normalBake');

        // One by shape or by facing is as fine as the faces already are.
        expect(rock([{ id: 'moss', op: 'stain', faces: 'rock', color: [0.1, 0.2, 0.1], facing: [0, 1, 0] }]).some((w) => w.includes('split'))).toBe(false);
        // And a pattern before the decimate takes nothing back.
        const before = bakeModel({ version: 1, steps: [
            { id: 'body', op: 'sphere', radius: 1, rings: 16, sides: 24, tag: 'rock' },
            { id: 'lichen', op: 'stain', faces: 'rock', color: [0.3, 0.4, 0.2], pattern: 'bumps', scale: 0.12 },
            { id: 'thin', op: 'decimate', triangles: 200 },
        ] });
        expect(before.report.warnings.some((w) => w.includes('split'))).toBe(false);
    });
});

describe('a model\'s picture', () => {
    it('may be a recipe as well as an image, and nothing else', () => {
        const withTexture = (texture: string): unknown => ({ version: 1, material: { texture }, steps: [{ op: 'box', size: [1, 1, 1] }] });
        expect(() => validateModelSource(withTexture('assets/textures/bough.png'))).not.toThrow();
        expect(() => validateModelSource(withTexture('assets/textures/bough.esimage'))).not.toThrow();
        expect(() => validateModelSource(withTexture('assets/textures/bough.esmaterial'))).toThrow(/\.esimage/);
    });
});
