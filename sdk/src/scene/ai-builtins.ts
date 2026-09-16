// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    scene/ai-builtins.ts
 * @brief   The `.esfsm` / `.esbt` / `.esgraph` → SceneManager bridge.
 *
 * Changing scene is the one thing gameplay needs that no component can express:
 * it retires the world those components live in. Registered from the scene side
 * (scene → ai, one direction) so the `ai` module never learns about scenes;
 * idempotent and namespaced, so game-registered names win.
 */

import { aiRegistry, type AiContext } from '../ai/fsm/AiContext';
import type { AiParamDef, AiParamValue, AiParams } from '../ai/fsm/registry';
import { SceneManager, type SceneManagerState, type TransitionOptions } from './sceneManager';
import { log } from '../util/logger';

const FADE: AiParamDef = {
    name: 'fade',
    type: 'number',
    tooltip: 'Seconds to fade through; 0 cuts straight over',
};

/**
 * Register the scene verbs. Idempotent (and safe after an `aiRegistry.clear()`):
 * each name registers only if absent.
 */
export function ensureSceneAiRegistrations(): void {
    verb('scene.load', [{ name: 'scene', type: 'string' }, FADE], (scenes, params) => {
        const name = typeof params?.scene === 'string' ? params.scene.trim() : '';
        if (!name) return;
        void scenes.switchTo(name, transitionOf(params?.fade));
    });

    // Not `scene.load` of the scene already running: asked for that, switchTo
    // does nothing — the right answer for a gate and the wrong one for every
    // death, retry and restart there is.
    verb('scene.reload', [FADE], (scenes, params) => {
        void scenes.reload(transitionOf(params?.fade));
    });
}

function verb(
    name: string,
    params: readonly AiParamDef[],
    run: (scenes: SceneManagerState, params: AiParams | undefined) => void,
): void {
    if (aiRegistry.hasAction(name)) return;
    aiRegistry.registerAction(name, {
        params,
        // It retires every entity there is; nothing narrower would be honest.
        touches: { opaque: true },
        run: (ctx: AiContext, _bb, _arg, given) => {
            // An event can fire before the first frame has handed the interpreter
            // its commands, and a verb reached that early has no door yet.
            const scenes = ctx.commands?.resource(SceneManager) ?? null;
            if (!scenes) {
                log.warn('scene', `${name}: no SceneManager to reach`);
                return;
            }
            run(scenes, given);
        },
    });
}

/** A fade of `seconds`, or an immediate cut when there is none to speak of. */
function transitionOf(seconds: AiParamValue | undefined): TransitionOptions | undefined {
    const duration = Number(seconds ?? 0);
    return duration > 0 ? { transition: 'fade', duration } : undefined;
}
