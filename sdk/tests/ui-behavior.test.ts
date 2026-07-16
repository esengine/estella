// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect } from 'vitest';
import {
    Interactable,
    UIInteraction,
    Focusable,
    Draggable,
} from '../src/ui';

describe('ui2 behavior components', () => {
    describe('re-exported behaviors', () => {
        it('Interactable points at the existing builtin', () => {
            expect(Interactable._builtin).toBe(true);
            expect(Interactable._name).toBe('Interactable');
        });

        it('UIInteraction points at the existing builtin', () => {
            expect(UIInteraction._builtin).toBe(true);
            expect(UIInteraction._name).toBe('UIInteraction');
        });

        it('Focusable is a user component (ts-side)', () => {
            expect(Focusable._builtin).toBe(false);
            expect(Focusable._name).toBe('Focusable');
        });

        it('Draggable is a user component (ts-side)', () => {
            expect(Draggable._builtin).toBe(false);
            expect(Draggable._name).toBe('Draggable');
        });
    });
});
