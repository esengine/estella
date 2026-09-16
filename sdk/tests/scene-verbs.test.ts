// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    scene-verbs.test.ts
 * @brief   Changing scene from an authored surface — the one thing gameplay
 *          needs that no component write can express.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { aiRegistry } from '../src/ai/fsm/AiContext';
import { Blackboard } from '../src/ai/fsm/Blackboard';
import { ensureSceneAiRegistrations } from '../src/scene/ai-builtins';
import { SceneManager, type SceneManagerState } from '../src/scene/sceneManager';
import { CommandsInstance } from '../src/ecs/commands';
import { ResourceStorage, defineResource } from '../src/ecs/resource';
import type { World } from '../src/ecs/world';

function sceneManager() {
    return {
        switchTo: vi.fn().mockResolvedValue(undefined),
        reload: vi.fn().mockResolvedValue(undefined),
    } as unknown as SceneManagerState;
}

/** A context carrying only what these verbs reach for: the commands door. */
function ctxWith(scenes: SceneManagerState | null) {
    const resources = new ResourceStorage();
    if (scenes) resources.insert(SceneManager, scenes);
    const commands = new CommandsInstance({} as World, resources);
    return { commands } as never;
}

beforeEach(() => {
    aiRegistry.clear();
    ensureSceneAiRegistrations();
});

describe('the scene verbs', () => {
    it('switches to the scene it names, cutting straight over by default', () => {
        const scenes = sceneManager();
        aiRegistry.getAction('scene.load')!(ctxWith(scenes), new Blackboard(), 'level-2');
        expect(scenes.switchTo).toHaveBeenCalledWith('level-2', undefined);
    });

    it('fades for the seconds it is given', () => {
        const scenes = sceneManager();
        aiRegistry.getAction('scene.load')!(ctxWith(scenes), new Blackboard(), undefined, { scene: 'menu', fade: 0.6 });
        expect(scenes.switchTo).toHaveBeenCalledWith('menu', { transition: 'fade', duration: 0.6 });
    });

    it('reloads the running scene, which switchTo cannot express', () => {
        const scenes = sceneManager();
        aiRegistry.getAction('scene.reload')!(ctxWith(scenes), new Blackboard());
        expect(scenes.reload).toHaveBeenCalledWith(undefined);
    });

    it('says so, instead of throwing, in an app with no scene manager', () => {
        expect(() => aiRegistry.getAction('scene.load')!(ctxWith(null), new Blackboard(), 'level-2')).not.toThrow();
    });

    it('does nothing when no scene is named', () => {
        const scenes = sceneManager();
        aiRegistry.getAction('scene.load')!(ctxWith(scenes), new Blackboard(), '  ');
        expect(scenes.switchTo).not.toHaveBeenCalled();
    });
});

describe('the commands door to a service', () => {
    const Clock = defineResource({ hour: 9 }, 'TestClock');

    it('hands back what a plugin installed', () => {
        const resources = new ResourceStorage();
        resources.insert(Clock, { hour: 11 });
        expect(new CommandsInstance({} as World, resources).resource(Clock)).toEqual({ hour: 11 });
    });

    it('answers null for a service nobody installed, not its default', () => {
        // Reading through `get` would MATERIALISE the default and report the
        // service present — so a verb would act on a value no plugin ever put
        // there instead of saying the app has none.
        const resources = new ResourceStorage();
        expect(new CommandsInstance({} as World, resources).resource(Clock)).toBeNull();
    });
});
