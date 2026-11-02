// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  A Cocos camera's `_clearFlags` become the engine's: the UI camera clears depth only, so what the world camera drew under it stays.
 */
import { describe, expect, it } from 'vitest';
import { engineClearFlags } from '../src/import/cocos/components';

describe('engineClearFlags', () => {
    it('maps the graphics API bits to colour and depth', () => {
        expect(engineClearFlags(7)).toBe(3);   // solid colour: colour, depth, stencil
        expect(engineClearFlags(6)).toBe(2);   // depth only: the UI camera's
        expect(engineClearFlags(0)).toBe(0);   // does not clear
        expect(engineClearFlags(14)).toBe(3);  // a skybox the engine does not have: cleared to colour
    });
});
