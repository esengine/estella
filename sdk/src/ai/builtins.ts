// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    builtins.ts
 * @brief   Engine-provided AI actions/conditions — code-free glue from
 *          `.esfsm`/`.esbt` data to engine subsystems.
 *
 * Registered when the FSM/BT plugin builds, so the names show up in the editor
 * palettes next to game-registered ones. Namespaced (`timeline.…`) to stay clear
 * of game action names; a name already present in the registry is never
 * overwritten, so game code wins regardless of registration order. Everything
 * here speaks through components — the same channel game code and the editor
 * use — never through resources.
 */

import { aiRegistry, type AiContext } from './fsm/AiContext';
import type { AiAction, AiCondition } from './fsm/registry';
import { TimelinePlayer } from '../timeline/TimelinePlugin';

/**
 * Register the engine's built-in actions/conditions. Idempotent (and safe after
 * an `aiRegistry.clear()`): each name registers only if absent.
 */
export function ensureBuiltinAiRegistrations(): void {
    action('timeline.play', ctx => {
        if (!ctx.has(TimelinePlayer)) return;
        const player = ctx.get(TimelinePlayer);
        if (player.playing) return;
        // Raising the flag on a finished clip replays it from the top — the
        // TimelinePlayer flag contract (see TimelineDrive.applyPlayerFlags).
        player.playing = true;
        ctx.set(TimelinePlayer, player);
    });

    action('timeline.pause', ctx => {
        if (!ctx.has(TimelinePlayer)) return;
        const player = ctx.get(TimelinePlayer);
        if (!player.playing) return;
        player.playing = false;
        ctx.set(TimelinePlayer, player);
    });

    // Latched only when a Once clip completes — false before and while playing,
    // so `onEnter: timeline.play` + a `timeline.finished` transition is a
    // self-contained cutscene state. The `!playing` term matters on replay: the
    // FSM raises `playing` and evaluates its transitions in the same tick, before
    // the timeline system has rewound the clip and cleared the stale latch.
    condition('timeline.finished', ctx => {
        if (!ctx.has(TimelinePlayer)) return false;
        const player = ctx.get(TimelinePlayer);
        return player.finished && !player.playing;
    });
}

function action(name: string, fn: AiAction<AiContext>): void {
    if (!aiRegistry.hasAction(name)) aiRegistry.registerAction(name, fn);
}

function condition(name: string, fn: AiCondition<AiContext>): void {
    if (!aiRegistry.hasCondition(name)) aiRegistry.registerCondition(name, fn);
}
