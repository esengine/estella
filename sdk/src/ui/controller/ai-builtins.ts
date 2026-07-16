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

/**
 * Idempotently register the UI AI glue. `ui.setPage` takes an arg `"controller:page"`
 * and switches the nearest controller of that name (self → ancestors) to the page,
 * guarding unknown controllers/pages (a no-op, same as {@link setControllerPage}).
 * Called when the controller plugin builds (and re-called after an aiRegistry clear).
 */
export function ensureControllerAiRegistrations(): void {
    if (aiRegistry.hasAction('ui.setPage')) return;
    aiRegistry.registerAction('ui.setPage', (ctx, _bb, arg) => {
        if (!arg) return;
        const sep = arg.indexOf(':');
        if (sep < 0) return;
        setControllerPage(ctx.world, ctx.entity, arg.slice(0, sep), arg.slice(sep + 1));
    });
}
