// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  suite-ownership.test.ts — the lookup a push decides its suites by.
 *
 * The shape it exists for happened: a tool gained a call, the double that stands
 * in for it in the editor suite did not, and the push boundary ran no suite that
 * compares the two.
 */
import { describe, it, expect } from 'vitest';
// @ts-expect-error — a repo tool, shipped as .mjs with no declarations
import { GATES, owedSuites } from '../gates.mjs';

const owed = (...paths: string[]): string[] => [...owedSuites(paths)].sort();

describe('owedSuites names the direct unit-test owner of a change', () => {
    it('owes the editor suite for the editor source, which is where it happened', () => {
        expect(owed('desktop/src/tools/transformTools.ts')).toEqual(['editor-tests']);
        // The editor is a submodule: a pointer bump names the directory itself,
        // and so does a dirty checkout. Both are changes the suite answers for.
        expect(owed('desktop')).toEqual(['editor-tests']);
    });

    it('owes each package suite for its own source', () => {
        expect(owed('sdk/src/camera/Camera.ts')).toEqual(['sdk-tests']);
        expect(owed('pipeline/src/world/cookWorld.ts')).toEqual(['engine-tests']);
        expect(owed('tools/check-suite-ownership.mjs')).toEqual(['engine-tests']);
        expect(owed('plugins/ldtk/src/index.ts')).toEqual(['plugin-tests']);
        expect(owed('compiler/src/lower.ts')).toEqual(['compiler-tests']);
    });

    it('owes every suite a change actually touches, and only those', () => {
        expect(owed('desktop/src/panels/Viewport.tsx', 'sdk/src/ui/util/math.ts'))
            .toEqual(['editor-tests', 'sdk-tests']);
    });

    // Docs, examples and the C++ tree have owners of other kinds; claiming a TS
    // unit suite for them would run minutes that answer nothing.
    it('owes nothing for source no suite is the unit-test owner of', () => {
        expect(owed('docs/REARCH_NOTES.md', 'examples/sprite-rendering/src/main.ts',
                    'native/src/app.cpp', 'README.md')).toEqual([]);
    });

    // A prefix must not swallow a sibling that merely starts with the same letters.
    it('matches on path segments, not on string prefixes', () => {
        expect(owed('sdk-extras/src/x.ts')).toEqual([]);
        expect(owed('toolsmith/x.mjs')).toEqual([]);
    });

    // The declaration this all reads from cannot be half-filled: a suite with no
    // `owns` is never owed by anything and nothing says so.
    it('leaves no suite unable to be owed', () => {
        const orphans = (GATES as Array<{ id: string; covers?: string[]; owns?: string[] }>)
            .filter((g) => g.covers?.length && !g.owns?.length)
            .map((g) => g.id);
        expect(orphans).toEqual([]);
    });
});
