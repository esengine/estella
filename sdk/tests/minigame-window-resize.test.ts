// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    minigame-window-resize.test.ts
 * @brief   The display canvas follows the window. Sized once at boot it keeps
 *          the old space while touches keep arriving in the window's, so what is
 *          drawn and what is hit come apart — a game that renders and answers no
 *          tap at all, which is what a host opening in the other orientation
 *          looks like.
 */
import { describe, it, expect, vi } from 'vitest';
import { MiniGamePlatformAdapter } from '../src/platform/minigame/adapter';
import type { MiniGameCanvas } from '../src/platform/minigame/api';

function host(info: { windowWidth: number; windowHeight: number; pixelRatio: number }) {
    const canvas = { width: 0, height: 0, getContext: () => null } as unknown as MiniGameCanvas;
    let resized: ((res: { windowWidth: number; windowHeight: number }) => void) | null = null;
    const g = {
        createCanvas: () => canvas,
        getSystemInfoSync: () => info,
        onWindowResize: (cb: (res: { windowWidth: number; windowHeight: number }) => void) => { resized = cb; },
    };
    const adapter = new MiniGamePlatformAdapter({ id: 'wechat', hostLabel: 'WeChat', global: g } as never);
    return { adapter, canvas, g, resize: (w: number, h: number) => resized?.({ windowWidth: w, windowHeight: h }) };
}

describe('the mini-game display canvas', () => {
    it('is sized to the window at boot, in device pixels', () => {
        const { adapter, canvas } = host({ windowWidth: 812, windowHeight: 375, pixelRatio: 3 });
        expect(adapter.createScreenCanvas()).toBe(canvas);
        expect([canvas.width, canvas.height]).toEqual([2436, 1125]);
    });

    it('follows the window when it changes — a rotation is not a new game', () => {
        const { adapter, canvas, resize } = host({ windowWidth: 375, windowHeight: 812, pixelRatio: 3 });
        adapter.createScreenCanvas();
        expect([canvas.width, canvas.height]).toEqual([1125, 2436]);

        resize(812, 375);

        expect([canvas.width, canvas.height]).toEqual([2436, 1125]);
    });

    it('takes the size the resize event carries, not a re-read of system info', () => {
        // `getSystemInfoSync` beside the event can still answer with the old
        // window; the event is the one that knows what just happened.
        const { adapter, canvas, resize } = host({ windowWidth: 375, windowHeight: 812, pixelRatio: 2 });
        adapter.createScreenCanvas();
        resize(812, 375);
        expect([canvas.width, canvas.height]).toEqual([1624, 750]);
    });

    it('keeps the host default when a measurement is missing', () => {
        const { adapter, canvas, resize } = host({ windowWidth: 375, windowHeight: 812, pixelRatio: 1 });
        adapter.createScreenCanvas();
        resize(0, 0);
        expect([canvas.width, canvas.height]).toEqual([375, 812]);
    });

    it('does not require the host to offer onWindowResize', () => {
        const canvas = { width: 0, height: 0, getContext: () => null } as unknown as MiniGameCanvas;
        const g = {
            createCanvas: () => canvas,
            getSystemInfoSync: () => ({ windowWidth: 100, windowHeight: 200, pixelRatio: 1 }),
        };
        const adapter = new MiniGamePlatformAdapter({ id: 'wechat', hostLabel: 'WeChat', global: g } as never);
        expect(() => adapter.createScreenCanvas()).not.toThrow();
        expect([canvas.width, canvas.height]).toEqual([100, 200]);
    });
});
