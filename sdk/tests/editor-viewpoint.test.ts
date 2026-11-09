// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { AppContext, setDefaultContext } from '../src/ecs/context';
import { createMockModule } from './mocks/wasm';
import { describe, expect, it } from 'vitest';
import { App } from '../src/app/app';
import { DEFAULT_EDITOR_VIEW, EditorView, editorViewEye } from '../src/camera/EditorView';
import { Camera, Transform } from '../src/ecs/component';
import { streamingSourcesOf } from '../src/residency/chunks';
import { WorldStreamingSource } from '../src/residency/components';

const at = (x: number, y: number, z: number) => ({ position: { x, y, z }, worldPosition: { x, y, z } });

function world(): App {
    setDefaultContext(new AppContext());
    const app = App.new(), module = createMockModule();
    app.connectCpp(module.getRegistry(), module);
    const source = app.world.spawn();
    app.world.insert(source, Transform, at(500, 0, 500));
    app.world.insert(source, WorldStreamingSource, { ...WorldStreamingSource._default });
    const camera = app.world.spawn();
    app.world.insert(camera, Transform, at(-900, 10, -900));
    app.world.insert(camera, Camera, { isActive: true });
    return app;
}

const ORBIT = { ...DEFAULT_EDITOR_VIEW, active: true, perspective: true, x: 2000, y: 40, z: -3000, distance: 300, yaw: 0.4, pitch: -0.5 };

describe('what grows round the editor view', () => {
    it('follows the 3D viewport past a streaming source in the scene', () => {
        const app = world();
        app.insertResource(EditorView, ORBIT);
        const eye = editorViewEye(ORBIT);
        expect(streamingSourcesOf(app)).toEqual([{ x: eye.x, y: eye.y, z: eye.z }]);
    });

    it('follows the 2D viewport to what it is looking at', () => {
        const app = world();
        app.insertResource(EditorView, { ...DEFAULT_EDITOR_VIEW, active: true, x: 700, y: -250 });
        expect(streamingSourcesOf(app)).toEqual([{ x: 700, y: -250, z: 0 }]);
    });

    it('gives the running game its sources once the view stands down', () => {
        const app = world();
        app.insertResource(EditorView, { ...ORBIT, active: false });
        expect(streamingSourcesOf(app)).toEqual([{ x: 500, y: 0, z: 500 }]);
    });
});
