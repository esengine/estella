// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    native-app-input.test.ts
 * @brief   The native App runtime (Stage B foundation): the same App + the native
 *          platform. A mock NativeBridge captures the input listener the SDK's real
 *          inputPlugin subscribes, so host touch flows through the actual
 *          inputPlugin -> native adapter -> Input resource path, headless.
 */
import { describe, expect, it } from 'vitest';
import { createNativeApp } from '../src/ecs/bridge/nativeRuntime';
import { Input } from '../src/input/input';
import type { NativeBridge, NativeInputListener } from '../src/platform/native/bridge';

/** A NativeBridge whose registerInput captures the engine's listener; everything
 *  else is a stub (input needs none of it). */
function makeBridge() {
    let listener: NativeInputListener | null = null;
    const bridge: NativeBridge = {
        readFile: async () => new ArrayBuffer(0),
        fileExists: async () => false,
        fetch: async () => ({ ok: false, status: 404 }),
        loadImagePixels: async () => ({ width: 0, height: 0, pixels: new Uint8Array(0) }),
        getStorageItem: () => null,
        setStorageItem: () => {},
        removeStorageItem: () => {},
        storageKeys: () => [],
        registerInput: (l) => { listener = l; return () => { listener = null; }; },
        devicePixelRatio: () => 1,
    };
    return { bridge, listener: () => listener };
}

describe('createNativeApp', () => {
    it('routes host touch through the real input plugin to the Input resource', async () => {
        const { bridge, listener } = makeBridge();
        const app = createNativeApp(bridge, {});

        // First tick finishes plugin builds: inputPlugin.build calls
        // getPlatform().bindInputEvents, which registers with the host bridge.
        await app.tick(0);
        const l = listener();
        expect(l).not.toBeNull();                       // the SDK subscribed to host input

        // The host pushes touch; the native adapter synthesizes the primary pointer.
        l!.onTouchStart(0, 100, 200);
        l!.onTouchMove(0, 150, 250);
        await app.tick(1 / 60);

        const input = app.getResource(Input);
        expect(input.getMousePosition()).toEqual({ x: 150, y: 250 });

        l!.onTouchEnd(0);
        await app.tick(1 / 60);
    });

    it('gives the game the real World over the native core', async () => {
        const { bridge } = makeBridge();
        const app = createNativeApp(bridge, {});
        await app.tick(0);
        expect(app.world).toBeDefined();
        expect(app.world.hasCpp).toBe(true);            // connected to the native registry
    });
});
