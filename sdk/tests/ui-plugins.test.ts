// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Guards the single composed UI pipeline (REARCH_GUI F6).
 *
 * The ten formerly-separate UI concept plugins are composed into one `uiPlugin`
 * (see ui/ui-plugin.ts). It builds UIInteraction before UIBehavior because the
 * behavior layer reads the UIEvents resource (inserted by UIInteraction) at
 * build time — the wrong order would leave the entire UI behavior layer dead.
 * Full build-order + tick behavior is exercised end-to-end by the createWebApp
 * path (headless render verification); this pins the default plugin set shape.
 */
import { describe, expect, it } from 'vitest';
import { uiPlugins } from '../src/uiPlugins';
import { uiPlugin } from '../src/ui/ui-plugin';

describe('default uiPlugins', () => {
    it('is the single composed UI pipeline', () => {
        expect(uiPlugins).toEqual([uiPlugin]);
        expect(uiPlugin.name).toBe('ui');
    });

    it('exposes the behavior-layer event bus via delegation', () => {
        // The getter delegates to the internal behavior plugin; before build it
        // throws rather than returning a half-wired bus.
        expect(() => uiPlugin.events).toThrow();
    });
});
