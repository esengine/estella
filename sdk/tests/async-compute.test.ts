// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Renderer, setRendererBackend } from '../src/render/renderer';
import { createNativeRendererBackend } from '../src/ecs/bridge/nativeRenderer';
import { applyFrameOptions } from '../src/app/renderOptions';
import { packagedAppOptions } from '../src/runtime/packagedRuntime';

afterEach(() => setRendererBackend(null));

describe('async compute', () => {
    it('reads the live native setting through the same switch as the debug console', () => {
        let enabled = false;
        setRendererBackend(createNativeRendererBackend({
            es_renderer_setAsyncComputeEnabled: (value: boolean) => { enabled = value; },
            es_renderer_getAsyncComputeEnabled: () => enabled,
            es_renderer_supportsAsyncCompute: () => true,
        }));
        expect(Renderer.supportsAsyncCompute()).toBe(true);
        Renderer.setAsyncComputeEnabled(true);
        expect(Renderer.consoleVariables['r.rdg.asynccompute']).toBe(1);
        Renderer.consoleVariables['r.rdg.asynccompute'] = 0;
        expect(enabled).toBe(false);
    });

    it('passes an explicit project setting to either core and resets it for a new app', () => {
        const api = { renderer_setAsyncComputeEnabled: vi.fn() };
        applyFrameOptions(api, packagedAppOptions({ asyncCompute: true }));
        applyFrameOptions(api, packagedAppOptions({ asyncCompute: false }));
        applyFrameOptions(api, undefined);
        expect(api.renderer_setAsyncComputeEnabled.mock.calls).toEqual([[true], [false], [false]]);
    });

    it('uses the single-queue defaults on older hosts', () => {
        setRendererBackend(createNativeRendererBackend({}));
        Renderer.setAsyncComputeEnabled(true);
        expect(Renderer.supportsAsyncCompute()).toBe(false);
        expect(Renderer.consoleVariables['r.rdg.asynccompute']).toBe(0);
    });
});
