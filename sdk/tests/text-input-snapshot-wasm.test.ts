// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/app/app';
import { bindRenderSurface } from '../src/app/surface';
import { AppContext, setDefaultContext } from '../src/ecs/context';
import { Canvas, Transform } from '../src/ecs/component';
import { Input, InputState } from '../src/input/input';
import { createWebTextEditor } from '../src/platform/webTextEditor';
import type { PlatformCanvas } from '../src/platform/types';
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
import { Interactable } from '../src/ui/input/interactable';
import { UIControlPointers } from '../src/ui/input/control-pointers';
import { MOUSE_POINTER } from '../src/ui/input/pointerBook';
import { TextInput } from '../src/ui/text/text-input';
import { UIPlugin } from '../src/ui/ui-plugin';
import type { CppRegistry, ESEngineModule } from '../src/wasm';
import { HAS_WASM, loadWasmModule } from './helpers/loadWasm';

vi.mock('../src/platform/base', async original => ({
    ...await original<typeof import('../src/platform/base')>(),
    platformCreateTextEditor: (canvas?: PlatformCanvas) => createWebTextEditor(canvas),
    platformHasGlyphRasterizer: () => true,
    platformRasterizeGlyph: () => ({ pixels: new Uint8Array(), width: 0, height: 0, advance: 24, bearingX: 0, bearingY: 0 }),
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

    const distance = 120, fov = Math.PI / 3;
    it('repairs only missing text field input components and keeps authored settings', async () => {
        const world = app.world, first = world.spawn();
        world.insert(first, TextInput);
        world.insert(first, Focusable, { tabIndex: 7 });
        world.insert(first, Interactable, { enabled: false, blockRaycast: false });
        await tick();
        const next = world.spawn();
        world.insert(next, TextInput);
        world.remove(first, Focusable);
        await tick();
        expect(world.get(first, Focusable).tabIndex).toBe(0);
        expect(world.get(first, Interactable)).toMatchObject({ enabled: false, blockRaycast: false });
        expect(world.has(next, Focusable)).toBe(true);
        expect(world.has(next, Interactable)).toBe(true);

        world.update(first, Focusable, value => { value.tabIndex = 11; });
        world.remove(first, Interactable);
        await tick();
        expect(world.get(first, Focusable).tabIndex).toBe(11);
        expect(world.get(first, Interactable)).toMatchObject({ enabled: true, blockRaycast: true });
    });

    const worldField = (tilt: number, value: string, cursorPos = 0) => {
        const { world } = app, field = world.spawn('field');
        world.insert(field, Transform, { position: { x: 0, y: 0, z: -distance },
            rotation: { x: 0, y: Math.sin(tilt / 2), z: 0, w: Math.cos(tilt / 2) } });
        world.insert(field, ContentRect, { size: { x: 100, y: 40 }, pivot: { x: 0.5, y: 0.5 } });
        world.insert(field, TextInput, { value, cursorPos, fontSize: 20, padding: 6 });
        app.insertResource(ScreenOverlay, defaultScreenOverlay());
        app.insertResource(UICameraInfo, { ...UICameraInfo._default, valid: true, vpW: 800, vpH: 600,
            screenW: 800, screenH: 600, viewProjection: perspective(fov, 800 / 600, 0.1, 1000) });
        engine.transform_update(registry);
        return field;
    };

    it.each([0, Math.PI / 3])('anchors the input surface to a world caret at depth with tilt %s', async tilt => {
        const field = worldField(tilt, '');
        app.world.insert(field, Focusable, { tabIndex: 0 });
        app.getResource(FocusManager).focus(field);
        await tick();
        await tick();

        const input = document.querySelector<HTMLTextAreaElement>('textarea[data-estella-text-editor]')!;
        const caretX = -44, caretY = -10;
        const eyeDepth = distance + caretX * Math.sin(tilt);
        const pixelsPerUnit = 300 / (Math.tan(fov / 2) * eyeDepth);
        expect(app.world.get(field, TextInput).focused).toBe(true);
        expect(input.style.left).toBe(`${Math.round(400 + caretX * Math.cos(tilt) * pixelsPerUnit)}px`);
        expect(input.style.top).toBe(`${Math.round(300 - caretY * pixelsPerUnit)}px`);
    });

    it('anchors a world caret to the translated and scaled canvas in the browser viewport', async () => {
        const canvas = document.body.appendChild(document.createElement('canvas'));
        Object.assign(canvas.style, { width: '400px', height: '240px', padding: '4px 6px', border: '2px solid' });
        canvas.getBoundingClientRect = () => new DOMRect(40, 60, 832, 378);
        vi.spyOn(window, 'ResizeObserver').mockImplementation(function (callback: ResizeObserverCallback) {
            const observer = {
                disconnect: vi.fn(), unobserve: vi.fn(),
                observe: () => callback([{ target: canvas, contentRect: new DOMRect(6, 4, 400, 240) } as ResizeObserverEntry], observer),
            };
            return observer;
        });
        // Reinstall the UI plugin from a fresh app so the render surface is known before input setup.
        app.quit();
        app = App.new();
        app.connectCpp(registry, engine);
        bindRenderSurface(app, { canvas }, { kind: 'gl-context', handle: 0 });
        app.insertResource(Input, new InputState());
        app.addPlugin(new UIPlugin());
        try {
            const field = worldField(0, '');
            app.world.insert(field, Focusable, { tabIndex: 0 });
            app.getResource(FocusManager).focus(field);
            await tick();
            await tick();
            const input = document.querySelector<HTMLTextAreaElement>('textarea[data-estella-text-editor]')!;
            const pixelsPerUnit = 300 / (Math.tan(fov / 2) * distance);
            expect(input.style.left).toBe(`${Math.round(56 + (400 - 44 * pixelsPerUnit))}px`);
            expect(input.style.top).toBe(`${Math.round(69 + (300 + 10 * pixelsPerUnit) * 0.6)}px`);
        } finally { canvas.remove(); vi.restoreAllMocks(); }
    });

    it.each([0, Math.PI / 3])('places the caret at the clicked text edge on a world field with tilt %s', async tilt => {
        const field = worldField(tilt, 'x', 1);
        await tick();
        const input = app.getResource(Input);
        const localX = -46;
        const eyeDepth = distance + localX * Math.sin(tilt);
        input.mouseX = 400 + localX * Math.cos(tilt) * 300 / (Math.tan(fov / 2) * eyeDepth);
        input.mouseY = 300;
        input.noteMouseDown(0);
        await tick();

        expect(app.getResource(UIControlPointers).pointers.get(MOUSE_POINTER)?.pressedEntity).toBe(field);
        expect(app.world.get(field, TextInput)).toMatchObject({ focused: true, cursorPos: 0 });
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
