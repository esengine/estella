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
import { SpriteAnimator } from '../animation/SpriteAnimator';

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

    // `arg` is the clip to play (a `.esanim` ref/path); without it the action
    // resumes/replays the animator's current clip. Same-clip play while already
    // playing is a no-op, so `onUpdate: spriteAnim.play` is safe.
    action('spriteAnim.play', (ctx, _bb, arg) => {
        if (!ctx.has(SpriteAnimator)) return;
        const sp = ctx.get(SpriteAnimator);
        const switching = !!arg && arg !== sp.clip;
        if (!switching && sp.playing) return;
        if (switching) {
            sp.clip = arg!;
            sp.currentFrame = 0;
            sp.frameTimer = 0;
            sp.finished = false;
        }
        // Raising the flag on a finished one-shot replays it from the top —
        // the SpriteAnimator flag contract (mirrors TimelinePlayer's).
        sp.playing = true;
        ctx.set(SpriteAnimator, sp);
    });

    // Unconditional rewind + play (re-trigger a one-shot mid-flight), with the
    // same optional clip arg.
    action('spriteAnim.restart', (ctx, _bb, arg) => {
        if (!ctx.has(SpriteAnimator)) return;
        const sp = ctx.get(SpriteAnimator);
        if (arg) sp.clip = arg;
        sp.currentFrame = 0;
        sp.frameTimer = 0;
        sp.finished = false;
        sp.playing = true;
        ctx.set(SpriteAnimator, sp);
    });

    action('spriteAnim.stop', ctx => {
        if (!ctx.has(SpriteAnimator)) return;
        const sp = ctx.get(SpriteAnimator);
        if (!sp.playing) return;
        sp.playing = false;
        ctx.set(SpriteAnimator, sp);
    });

    // Latched only when a one-shot clip completes (same shape as
    // timeline.finished): false before and while playing, so
    // `onEnter: spriteAnim.play` + a `spriteAnim.finished` transition is a
    // self-contained attack/one-shot state.
    condition('spriteAnim.finished', ctx => {
        if (!ctx.has(SpriteAnimator)) return false;
        const sp = ctx.get(SpriteAnimator);
        return sp.finished && !sp.playing;
    });
}

function action(name: string, fn: AiAction<AiContext>): void {
    if (!aiRegistry.hasAction(name)) aiRegistry.registerAction(name, fn);
}

function condition(name: string, fn: AiCondition<AiContext>): void {
    if (!aiRegistry.hasCondition(name)) aiRegistry.registerCondition(name, fn);
}
