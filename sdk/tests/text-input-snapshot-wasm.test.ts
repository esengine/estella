// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/app/app';
import { AppContext, setDefaultContext } from '../src/ecs/context';
import { Canvas, Transform } from '../src/ecs/component';
import { Input, InputState } from '../src/input/input';
import { createWebTextEditor } from '../src/platform/webTextEditor';
import { perspective } from '../src/math/mat4';
import { resetWorldTo, serializeScene } from '../src/scene/scene';
import { ContentRect } from '../src/ui/core/content-rect';
import { ScreenOverlay, defaultScreenOverlay } from '../src/ui/core/screen-overlay';
import { UICameraInfo } from '../src/ui/core/ui-camera-info';
import { px } from '../src/ui/core/dimension';
import { Text } from '../src/ui/core/text';
import { UIMask } from '../src/ui/core/ui-mask';
import { UINode } from '../src/ui/core/ui-node';
import { UIVisual } from '../src/ui/core/ui-visual';
import { Focusable, FocusManager } from '../src/ui/input/focusable';
import { TextInput } from '../src/ui/text/text-input';
import { UIPlugin } from '../src/ui/ui-plugin';
import type { CppRegistry, ESEngineModule } from '../src/wasm';
import { HAS_WASM, loadWasmModule } from './helpers/loadWasm';

vi.mock('../src/platform/base', async original => ({
    ...await original<typeof import('../src/platform/base')>(),
    platformCreateTextEditor: () => createWebTextEditor(),
}));

describe.skipIf(!HAS_WASM)('text field scene round trips', () => {
    let engine: ESEngineModule, registry: CppRegistry, app: App;
    beforeAll(async () => { engine = await loadWasmModule(); });
    beforeEach(() => {
        setDefaultContext(new AppContext());
        registry = new engine.Registry();
        app = App.new();
        app.connectCpp(registry, engine);
        app.insertResource(Input, new InputState());
        app.addPlugin(new UIPlugin());
    });
    afterEach(() => { app.quit(); registry.delete(); });
    const tick = async () => {
        engine.uiLayout_update(registry, -400, -300, 400, 300, true);
        await app.tick(1 / 60);
    };

    it.each([0, Math.PI / 3])('anchors the input surface to a world caret at depth with tilt %s', async tilt => {
        const { world } = app, field = world.spawn('field');
        const distance = 120, fov = Math.PI / 3;
        world.insert(field, Transform, { position: { x: 0, y: 0, z: -distance },
            rotation: { x: 0, y: Math.sin(tilt / 2), z: 0, w: Math.cos(tilt / 2) } });
        world.insert(field, ContentRect, { size: { x: 100, y: 40 }, pivot: { x: 0.5, y: 0.5 } });
        world.insert(field, TextInput, { value: '', fontSize: 20, padding: 6 });
        world.insert(field, Focusable, { tabIndex: 0 });
        app.insertResource(ScreenOverlay, defaultScreenOverlay());
        app.insertResource(UICameraInfo, { ...UICameraInfo._default, valid: true, vpW: 800, vpH: 600,
            screenW: 800, screenH: 600, viewProjection: perspective(fov, 800 / 600, 0.1, 1000) });
        engine.transform_update(registry);
        app.getResource(FocusManager).focus(field);
        await tick();
        await tick();

        const input = document.querySelector<HTMLTextAreaElement>('textarea[data-estella-text-editor]')!;
        const caretX = -44, caretY = -10;
        const eyeDepth = distance + caretX * Math.sin(tilt);
        const pixelsPerUnit = 300 / (Math.tan(fov / 2) * eyeDepth);
        expect(world.get(field, TextInput).focused).toBe(true);
        expect(input.style.left).toBe(`${Math.round(400 + caretX * Math.cos(tilt) * pixelsPerUnit)}px`);
        expect(input.style.top).toBe(`${Math.round(300 - caretY * pixelsPerUnit)}px`);
    });

    it('saves the committed value of a focused field and drops the editing session on reload', async () => {
        const world = app.world, field = world.spawn('field');
        world.insert(field, Transform);
        world.insert(field, TextInput, { value: 'saved', cursorPos: 2 });
        world.insert(field, Focusable, { tabIndex: 7 });
        const manager = app.getResource(FocusManager);
        manager.focus(field);
        await tick();
        expect(world.get(field, TextInput).focused).toBe(true);

        const scene = serializeScene(world);
        const saved = scene.entities.find(e => e.id === field)!.components.find(c => c.type === 'TextInput')!.data;
        expect(saved).toMatchObject({ value: 'saved', cursorPos: 2 });
        expect(saved.focused).toBeUndefined();
        expect(world.get(field, TextInput).focused).toBe(true);
        saved.focused = true; // Earlier snapshots included the old OS surface state.
        const replacement = resetWorldTo(world, scene).get(field)!;
        expect(world.get(replacement, TextInput)).toMatchObject({ value: 'saved', cursorPos: 2, focused: false });
        await tick();
        expect(manager.focusedEntity).toBeNull();
        expect(world.get(replacement, Focusable).tabIndex).toBe(7);
    });

    for (const domain of ['screen', 'world'] as const) {
        it.each(['generated', 'authored', 'same-value takeover', 'removed before next frame'] as const)(
            domain + ' field with %s components retains only authored content', async ownership => {
                const world = app.world, root = world.spawn('root'), field = world.spawn('field'), caption = world.spawn();
                world.setParent(field, root);
                world.setParent(caption, field);
                for (const entity of [root, field, caption]) world.insert(entity, Transform);
                if (domain === 'screen') {
                    world.insert(root, Canvas);
                    world.insert(root, UINode);
                    world.insert(field, UINode, { width: px(160), height: px(40) });
                } else {
                    world.insert(field, ContentRect, { size: { x: 160, y: 40 } });
                }
                // An unnamed author's text with the same content is indistinguishable by appearance.
                world.insert(caption, Text, { content: 'example' });
                world.insert(field, TextInput, { value: 'example' });
                if (ownership === 'authored') {
                    world.insert(field, UIVisual, { color: { r: 1, g: 0, b: 0, a: 1 } });
                    world.insert(field, UIMask, { enabled: false });
                }
                await tick();
                expect(world.getEntitiesWithComponents([Text])).toHaveLength(2);
                if (ownership === 'same-value takeover') {
                    if (domain === 'screen') world.insert(field, UIVisual, world.get(field, UIVisual));
                    world.insert(field, UIMask, world.get(field, UIMask));
                }
                if (ownership === 'removed before next frame') world.remove(field, TextInput);

                const scene = serializeScene(world);
                expect(scene.entities.map(e => e.id).sort()).toEqual([root, field, caption].sort());
                const owner = scene.entities.find(e => e.id === field)!;
                expect(owner.children).toEqual([caption]);
                const components = owner.components.map(c => c.type);
                const hasInput = ownership !== 'removed before next frame';
                const hasMask = ownership === 'authored' || ownership === 'same-value takeover';
                const hasFill = ownership === 'authored' || (domain === 'screen' && ownership === 'same-value takeover');
                expect(components.includes('UIVisual')).toBe(hasFill);
                expect(components.includes('UIMask')).toBe(hasMask);
                expect(components.includes('TextInput')).toBe(hasInput);
                const reloaded = resetWorldTo(world, scene);
                await tick();
                expect(world.get(reloaded.get(caption)!, Text).content).toBe('example');
                expect(world.getEntitiesWithComponents([Text])).toHaveLength(hasInput ? 2 : 1);
                expect(serializeScene(world).entities).toHaveLength(3);
            });
    }
});
