// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  An app with the engine's real pointer pipeline, for tests that touch Cocos nodes.
 *
 * The camera maps the world square 0..800 x 0..800 onto an 800 x 800 surface, so a world point (x, y) is the surface pixel (x, y)
 * counted from the bottom-left, and the pointer for it is at CSS (x, 800 - y). Every press, move and release is a real frame:
 * the input state is set, the app ticks, and the engine's interaction system picks, holds and reports as it does in a game.
 */
import { App, flushPendingRegistrations } from '../../../src/app/app';
import { registerComponent } from '../../../src/ecs/component';
import { AppContext, setDefaultContext } from '../../../src/ecs/context';
import { Input, InputState } from '../../../src/input/input';
import { UICameraInfo } from '../../../src/ui/core/ui-camera-info';
import { UILayoutGeneration } from '../../../src/ui/layout/ui-layout-generation';
import { uiInteractionPlugin } from '../../../src/ui/input/interaction';
import { focusPlugin } from '../../../src/ui/input/focus';
import { textInputPlugin } from '../../../src/ui/text/text-input-plugin';
import { ensureBuiltinComponentsRegistered } from '../../../src/ecs/component';
import { resetClassRegistry } from '../../../src/cocos/registry';
import { declareBuiltinScripts } from '../../../src/cocos/builtinScripts';
import { setCurrentWorld } from '../../../src/cocos';
import type { ESEngineModule } from '../../../src/wasm';

export const SURFACE = 800;

export interface PointerApp {
    app: App;
    input: InputState;
    /** One frame. */
    frame(n?: number): Promise<void>;
    /** A finger lands on the world point (x, y). */
    press(x: number, y: number, id?: number): Promise<void>;
    move(x: number, y: number, id?: number): Promise<void>;
    release(x: number, y: number, id?: number): Promise<void>;
    tap(x: number, y: number): Promise<void>;
    dispose(): void;
}

/** @p origin: how far the world's origin sits from the surface's bottom-left corner, in pixels: a surface point is the world point plus it. */
export function pointerApp(module: ESEngineModule, origin: { x: number; y: number } = { x: 0, y: 0 }, options: { fields?: boolean } = {}): PointerApp {
    setDefaultContext(new AppContext());
    ensureBuiltinComponentsRegistered();
    resetClassRegistry();
    declareBuiltinScripts();
    const registry = new module.Registry();
    const app = App.new();
    app.connectCpp(registry as never, module);
    const input = new InputState();
    app.insertResource(Input, input);
    const s = 2 / SURFACE;
    const projection = new Float32Array([s, 0, 0, 0, 0, s, 0, 0, 0, 0, -0.001, 0, -1 + s * origin.x, -1 + s * origin.y, 0, 1]);
    app.insertResource(UICameraInfo, {
        ...UICameraInfo._default, viewProjection: projection, vpX: 0, vpY: 0, vpW: SURFACE, vpH: SURFACE, screenW: SURFACE, screenH: SURFACE, valid: true,
    });
    app.insertResource(UILayoutGeneration, { generation: 0 });
    uiInteractionPlugin.build(app);
    // text fields: focus follows a press, and the field's plugin takes the text surface
    if (options.fields) {
        focusPlugin.build(app);
        textInputPlugin.build(app);
    }
    flushPendingRegistrations(app);
    setCurrentWorld(app.world);

    // a world point is the surface point minus the origin; CSS y counts from the top
    const css = (x: number, y: number, id: number) => ({ id, x: x + origin.x, y: SURFACE - (y + origin.y) });
    const frame = async (n = 1): Promise<void> => {
        for (let i = 0; i < n; i++) {
            app.world.ensureTransformsComposed();
            await app.tick(1 / 60);
        }
    };
    return {
        app, input, frame,
        async press(x, y, id = 1) {
            const p = css(x, y, id);
            input.touches.set(id, p);
            input.touchesStarted.set(id, p);
            await frame();
            input.touchesStarted.clear();
        },
        async move(x, y, id = 1) {
            input.touches.set(id, css(x, y, id));
            await frame();
        },
        async release(x, y, id = 1) {
            const p = css(x, y, id);
            input.touches.delete(id);
            input.touchesEnded.set(id, p);
            await frame();
            input.touchesEnded.clear();
        },
        async tap(x, y) {
            await this.press(x, y);
            await this.release(x, y);
        },
        dispose() {
            uiInteractionPlugin.cleanup(app);
            textInputPlugin.cleanup(app);
            setCurrentWorld(null);
            app.world.disconnectCpp();
            registry.delete();
        },
    };
}

export { registerComponent };
