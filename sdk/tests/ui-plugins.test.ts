// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Guards that the default UI plugin set wires the behavior layer.
 *
 * Regression: uiBehaviorPlugin (interactable state machine, state-visual
 * application, list-view + scroll-wheel) existed and was exported but was never
 * added to `uiPlugins`, so createWebApp never registered it and the entire UI
 * behavior layer silently never ticked. This pins it into the default set.
 */
import { describe, expect, it } from 'vitest';
import { uiPlugins } from '../src/uiPlugins';

describe('default uiPlugins', () => {
    it('includes the UI behavior layer (uiBehavior)', () => {
        expect(uiPlugins.some((p) => p.name === 'uiBehavior')).toBe(true);
    });

    it('orders the behavior layer after its UIInteraction dependency', () => {
        const interaction = uiPlugins.findIndex((p) => p.name === 'uiInteraction');
        const behavior = uiPlugins.findIndex((p) => p.name === 'uiBehavior');
        expect(interaction).toBeGreaterThanOrEqual(0);
        expect(behavior).toBeGreaterThan(interaction);
    });
});
