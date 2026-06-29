// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect } from 'vitest';
import { getAllRegisteredComponents, getComponentFieldMeta } from '../src/component';

// Equivalence gate for RC9-1 (rich reflection metadata, single authoring source).
// P2 moves the authority for builtin field presentation metadata from the
// hand-written component.ts overlay into generated COMPONENT_META.fields. That
// migration changes the *source* of these values, never the values themselves —
// this snapshot fails if any field's resolved metadata drifts during the move.
describe('builtin FieldMeta (RC9-1 equivalence gate)', () => {
    it('matches the golden snapshot of every builtin with declared field metadata', () => {
        const names = [...getAllRegisteredComponents().keys()].sort();
        const golden: Record<string, Readonly<Record<string, unknown>>> = {};
        for (const name of names) {
            const meta = getComponentFieldMeta(name);
            if (Object.keys(meta).length > 0) golden[name] = meta;
        }
        expect(golden).toMatchSnapshot();
    });
});
