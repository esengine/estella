// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/** What a frame-stepping driver needs: which scenes are loading, and a way to wait for them. */
import { describe, it, expect } from 'vitest';
import { App } from '../src/app/app';
import { SceneManager } from '../src/scene/sceneManager';
import { sceneManagerPlugin } from '../src/scene/scenePlugin';

describe('SceneManager load tracking', () => {
    it('names a scene while it loads, and settles once it has', async () => {
        const app = App.new();
        app.addPlugin(sceneManagerPlugin);
        const scenes = app.getResource(SceneManager);
        let release!: () => void;
        const gate = new Promise<void>((r) => { release = r; });
        scenes.register({ name: 'level', setup: async () => { await gate; } });
        const loading = scenes.load('level');
        await Promise.resolve();
        expect(scenes.getLoading()).toEqual(['level']);
        let settled = false;
        const waiting = scenes.whenLoadsSettle().then(() => { settled = true; });
        await Promise.resolve();
        expect(settled).toBe(false);
        release();
        await loading; await waiting;
        expect(settled).toBe(true);
        expect(scenes.getLoading()).toEqual([]);
        expect(scenes.isLoaded('level')).toBe(true);
    });
});
