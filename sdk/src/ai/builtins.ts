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
import type { AiAction, AiActionInput, AiCondition, AiParamDef, AiParamValue, AiTouches } from './fsm/registry';
import { TimelinePlayer } from '../timeline/TimelinePlayerComponent';
import { SpriteAnimator } from '../animation/SpriteAnimator';
import { AudioSource } from '../audio/AudioComponents';
import { setEntityProperty } from '../ecs/propertyPath';
import type { AnyComponentDef, ComponentData } from '../ecs/component';
import type { Entity } from '../types';

const TIMELINE: AiTouches = { reads: [TimelinePlayer._name], writes: [TimelinePlayer._name] };
const SPRITE_ANIM: AiTouches = { reads: [SpriteAnimator._name], writes: [SpriteAnimator._name] };
const AUDIO: AiTouches = { reads: [AudioSource._name], writes: [AudioSource._name] };
/** The one parameter the play verbs take: which clip, empty for the current one. */
const CLIP_PARAM: readonly AiParamDef[] = [{ name: 'clip', type: 'string', tooltip: 'Leave empty to replay the current one' }];

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
    }, TIMELINE);

    action('timeline.pause', ctx => {
        if (!ctx.has(TimelinePlayer)) return;
        const player = ctx.get(TimelinePlayer);
        if (!player.playing) return;
        player.playing = false;
        ctx.set(TimelinePlayer, player);
    }, TIMELINE);

    // Latched only when a Once clip completes — false before and while playing,
    // so `onEnter: timeline.play` + a `timeline.finished` transition is a
    // self-contained cutscene state. The `!playing` term matters on replay: the
    // FSM raises `playing` and evaluates its transitions in the same tick, before
    // the timeline system has rewound the clip and cleared the stale latch.
    condition('timeline.finished', ctx => {
        if (!ctx.has(TimelinePlayer)) return false;
        const player = ctx.get(TimelinePlayer);
        return player.finished && !player.playing;
    }, { reads: [TimelinePlayer._name] });

    // `clip` is a `.esanim` ref/path; without it the action resumes/replays the
    // animator's current clip. Same-clip play while already playing is a no-op,
    // so `onUpdate: spriteAnim.play` is safe.
    playVerb('spriteAnim.play', SpriteAnimator, SPRITE_ANIM, (sp, clip) => {
        const switching = !!clip && clip !== sp.clip;
        if (!switching && sp.playing) return false;
        if (switching) {
            sp.clip = clip;
            sp.currentFrame = 0;
            sp.frameTimer = 0;
            sp.finished = false;
        }
        // Raising the flag on a finished one-shot replays it from the top —
        // the SpriteAnimator flag contract (mirrors TimelinePlayer's).
        sp.playing = true;
        return true;
    });

    // Unconditional rewind + play (re-trigger a one-shot mid-flight), with the
    // same optional clip.
    playVerb('spriteAnim.restart', SpriteAnimator, SPRITE_ANIM, (sp, clip) => {
        if (clip) sp.clip = clip;
        sp.currentFrame = 0;
        sp.frameTimer = 0;
        sp.finished = false;
        sp.playing = true;
        return true;
    });

    action('spriteAnim.stop', ctx => {
        if (!ctx.has(SpriteAnimator)) return;
        const sp = ctx.get(SpriteAnimator);
        if (!sp.playing) return;
        sp.playing = false;
        ctx.set(SpriteAnimator, sp);
    }, SPRITE_ANIM);

    // Latched only when a one-shot clip completes (same shape as
    // timeline.finished): false before and while playing, so
    // `onEnter: spriteAnim.play` + a `spriteAnim.finished` transition is a
    // self-contained attack/one-shot state.
    condition('spriteAnim.finished', ctx => {
        if (!ctx.has(SpriteAnimator)) return false;
        const sp = ctx.get(SpriteAnimator);
        return sp.finished && !sp.playing;
    }, { reads: [SpriteAnimator._name] });

    // — Sound. An AudioSource is played by raising its flag, the same contract
    //   the timeline and the sprite animator keep, so every authored surface
    //   starts a sound through the component it can already see. —
    playVerb('audio.play', AudioSource, AUDIO, (source, clip) => {
        const switching = !!clip && clip !== source.clip;
        if (switching) {
            source.clip = clip;
            source.finished = false;
        }
        // Already sounding THIS clip: raising a raised flag is not a replay, and
        // `onUpdate: audio.play` must not machine-gun the voice. Naming ANOTHER
        // clip is a second sound, so it goes through even mid-voice.
        if (!switching && source.playing) return false;
        source.playing = true;
        return true;
    });

    action('audio.stop', ctx => {
        if (!ctx.has(AudioSource)) return;
        const source = ctx.get(AudioSource);
        if (!source.playing) return;
        source.playing = false;
        ctx.set(AudioSource, source);
    }, AUDIO);

    // Latched only when a non-looping clip ends — the same shape as
    // `timeline.finished`, so `onEnter: audio.play` plus an `audio.finished`
    // transition is a state that lasts exactly as long as its sound.
    condition('audio.finished', ctx => {
        if (!ctx.has(AudioSource)) return false;
        const source = ctx.get(AudioSource);
        return source.finished && !source.playing;
    }, { reads: [AudioSource._name] });

    // The general-purpose write, through the engine's reflection writer — the
    // same addressing a UIGear binding and a Timeline track use ("Component" +
    // a dot path). One verb instead of a growing family of setters, and it
    // reaches project components as readily as builtins.
    //
    // `value` is parsed as JSON when it can be, so `3`, `true` and `{"r":1,...}`
    // arrive as themselves and a bare word stays a string.
    if (!aiRegistry.hasAction('property.set')) {
        aiRegistry.registerAction('property.set', {
            separator: '=',
            params: [
                { name: 'path', type: 'string', tooltip: 'Component.field, e.g. UIVisual.color.a' },
                { name: 'value', type: 'string' },
                // Optional third, so a game can write the entity it just found.
                // Trailing and empty by default, so a reference authored before
                // it reads and writes back byte-identically.
                { name: 'entity', type: 'number', tooltip: 'Leave empty for this entity' },
            ],
            run: (ctx, _bb, _arg, params) => {
                const path = typeof params?.path === 'string' ? params.path.trim() : '';
                const raw = params?.value;
                if (!path || raw === undefined) return;
                const target = Number(params?.entity ?? 0) || (ctx.entity as number);
                setEntityProperty(ctx.world, target as Entity, path, parseValue(raw));
            },
            // The component it writes is the first segment of the authored path,
            // so the reach is unknowable when this registers and plain in the
            // graph. A reference with no readable path admits it instead.
            touches: input => {
                const path = pathOf(input);
                const component = path.split('.')[0];
                return component ? { writes: [component] } : { opaque: true };
            },
        });
    }
}

/** `property.set`'s target path, from whichever form the reference carries: the
 *  named parameter, or the canonical `path=value` string. */
function pathOf(input: AiActionInput): string {
    const named = input.params?.path;
    if (typeof named === 'string') return named.trim();
    return (input.arg ?? '').split('=')[0].trim();
}

/** A parameter's JSON reading when it has one; otherwise the value itself. */
function parseValue(raw: AiParamValue): unknown {
    if (typeof raw !== 'string') return raw;
    try {
        return JSON.parse(raw.trim());
    } catch {
        return raw.trim();
    }
}

/**
 * A `play`-shaped verb: one optional `clip` parameter, declared — which is what
 * gives it an input pin in a graph instead of only a hand-typed `arg` — and a
 * component edit that says whether anything changed.
 */
function playVerb<C extends AnyComponentDef>(
    name: string,
    component: C,
    touches: AiTouches,
    edit: (data: ComponentData<C>, clip: string) => boolean,
): void {
    if (aiRegistry.hasAction(name)) return;
    aiRegistry.registerAction(name, {
        params: CLIP_PARAM,
        touches,
        run: (ctx, _bb, _arg, params) => {
            if (!ctx.has(component)) return;
            const data = ctx.get(component);
            if (edit(data, typeof params?.clip === 'string' ? params.clip.trim() : '')) {
                ctx.set(component, data);
            }
        },
    });
}

function action(name: string, fn: AiAction<AiContext>, touches?: AiTouches): void {
    if (!aiRegistry.hasAction(name)) aiRegistry.registerAction(name, { run: fn, touches });
}

function condition(name: string, fn: AiCondition<AiContext>, touches?: AiTouches): void {
    if (!aiRegistry.hasCondition(name)) aiRegistry.registerCondition(name, { check: fn, touches });
}
