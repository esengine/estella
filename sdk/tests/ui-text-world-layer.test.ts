// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    ui-text-world-layer.test.ts
 * @brief   A Text with no layout box is a label standing in the WORLD, and it
 *          sorts by Text.layer like any other world renderer.
 *
 *          It used to be pinned to layer 0 with nothing in the component to
 *          reach for, so anything else on layer 0 that drew later covered it —
 *          a board hiding its own pieces. Inside a Canvas the UI render order
 *          still decides, so the field must NOT leak into that path.
 */
import { describe, it, expect } from 'vitest';
import { Text, buildText } from '../src/ui';

describe('Text.layer', () => {
    it('is a field of the component, defaulting to 0', () => {
        const def = Text._default as { layer: number };
        expect(def.layer).toBe(0);
    });

    it('carries through buildText, so a composed label can name its layer', () => {
        expect(buildText().layer).toBe(0);
        expect(buildText({ layer: 5 }).layer).toBe(5);
    });

    it('says in the inspector that it is the world-space knob', () => {
        const tip = Text.fieldMeta['layer']?.tooltip ?? '';
        expect(tip).toMatch(/world/i);
        expect(tip).toMatch(/Canvas/i);
    });
});
