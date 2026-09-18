// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  What a game is told when the GPU comes back: one event per rebuilt
 *        device, never while content is still owed, and a render target saying
 *        its pixels are gone until whoever drew them draws them again.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    DeviceStatus, initRendererAPI, onDeviceRestored, pollDeviceRestored,
    resetDeviceRestoredWatch, shutdownRendererAPI,
} from '../src/render/renderer';
import type { ESEngineModule } from '../src/wasm';

/** A core whose device generation and status the test moves by hand. */
function core() {
    const state = { generation: 1, status: DeviceStatus.Live as number };
    initRendererAPI({
        renderer_deviceGeneration: () => state.generation,
        deviceStatus: () => state.status,
        _malloc: () => 0,
        _free: () => {},
    } as unknown as ESEngineModule);
    return state;
}

afterEach(() => {
    resetDeviceRestoredWatch();
    shutdownRendererAPI();
});

describe('onDeviceRestored', () => {
    it('fires once per rebuilt device, with the generation it came back as', () => {
        const state = core();
        const told = vi.fn();
        onDeviceRestored(told);

        pollDeviceRestored();               // first poll only learns where it started
        expect(told).not.toHaveBeenCalled();

        state.generation = 2;
        pollDeviceRestored();
        pollDeviceRestored();
        expect(told).toHaveBeenCalledTimes(1);
        expect(told).toHaveBeenCalledWith(2);

        state.generation = 3;
        pollDeviceRestored();
        expect(told).toHaveBeenCalledTimes(2);
        expect(told).toHaveBeenLastCalledWith(3);
    });

    it('waits until the device is whole — a Recovering one still draws placeholders', () => {
        const state = core();
        const told = vi.fn();
        onDeviceRestored(told);
        pollDeviceRestored();

        state.generation = 2;
        state.status = DeviceStatus.Recovering;
        pollDeviceRestored();
        expect(told).not.toHaveBeenCalled();

        state.status = DeviceStatus.Live;
        pollDeviceRestored();
        expect(told).toHaveBeenCalledTimes(1);
    });

    it('a loss the frame loop never saw in between is still one event', () => {
        const state = core();
        const told = vi.fn();
        onDeviceRestored(told);
        pollDeviceRestored();

        // Lost and whole again between two frames: the status says Live at both
        // ends, and only the generation says anything happened.
        state.generation = 2;
        pollDeviceRestored();
        expect(told).toHaveBeenCalledTimes(1);
    });

    it('stops telling an unsubscribed listener, and one that throws does not silence the next', () => {
        const state = core();
        const gone = vi.fn();
        const throws = vi.fn(() => { throw new Error('a game bug'); });
        const after = vi.fn();
        const unsubscribe = onDeviceRestored(gone);
        onDeviceRestored(throws);
        onDeviceRestored(after);
        pollDeviceRestored();

        unsubscribe();
        state.generation = 2;
        pollDeviceRestored();

        expect(gone).not.toHaveBeenCalled();
        expect(throws).toHaveBeenCalledTimes(1);
        expect(after).toHaveBeenCalledTimes(1);
    });
});
