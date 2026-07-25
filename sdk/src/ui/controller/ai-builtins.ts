// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    ui/controller/ai-builtins.ts
 * @brief   The .esfsm / .esbt → UIController bridge.
 *
 * Registers `ui.setPage` on the shared AI registry so data-driven behavior can
 * switch a controller's page with no code — the logic-layer half of the layering
 * `.esfsm (logic) → UIController (state) → UIGear (presentation)`, exactly the
 * shape of the built-in `timeline.play` / `spriteAnim.play` glue. Registered from
 * the UI side (ui → ai, one direction) so the `ai` module never learns about UI;
 * idempotent and namespaced, so game-registered names always win.
 */
import { aiRegistry } from '../../ai/fsm/AiContext';
import { setControllerPage } from './ui-controller';
import { UINode } from '../core/ui-node';
import { UIDisplay } from '../../wasm.generated';

/**
 * Idempotently register the UI AI glue. `ui.setPage` takes an arg `"controller:page"`
 * and switches the nearest controller of that name (self → ancestors) to the page,
 * guarding unknown controllers/pages (a no-op, same as {@link setControllerPage}).
 * Called when the controller plugin builds (and re-called after an aiRegistry clear).
 */
export function ensureControllerAiRegistrations(): void {
    ensureVisibilityAction();
    if (aiRegistry.hasAction('ui.setPage')) return;
    aiRegistry.registerAction('ui.setPage', {
        // Declaring the two halves is what turns the editor's single text box into
        // two dropdowns; the canonical `"controller:page"` string is unchanged, so
        // every `.esfsm` already on disk keeps working (registry.ts projects
        // between the two forms).
        params: [
            { name: 'controller', type: 'enum', optionsSource: 'uiController' },
            { name: 'page', type: 'enum', optionsSource: 'uiControllerPage' },
        ],
        run: (ctx, _bb, _arg, params) => {
            const controller = params?.controller;
            const page = params?.page;
            if (typeof controller !== 'string' || typeof page !== 'string' || !controller || !page) return;
            setControllerPage(ctx.world, ctx.entity, controller, page);
        },
    });
}

/**
 * Show/hide a UI subtree — the most common wire there is (a button opens a
 * panel). It drives `UINode.display`, the CSS-box switch Yoga and the renderer
 * both honour, NOT the `Disabled` tag: nothing in the render path reads Disabled
 * today, so a verb built on it would look right in the inspector and change
 * nothing on screen.
 */
function ensureVisibilityAction(): void {
    if (aiRegistry.hasAction('ui.setVisible')) return;
    aiRegistry.registerAction('ui.setVisible', {
        params: [{ name: 'visible', type: 'bool' }],
        run: (ctx, _bb, _arg, params) => {
            if (!ctx.has(UINode)) return;
            const visible = params?.visible === true;
            const node = ctx.get(UINode);
            const next = visible ? UIDisplay.Flex : UIDisplay.None;
            if (node.display === next) return;
            node.display = next;
            ctx.set(UINode, node);
        },
    });
}
