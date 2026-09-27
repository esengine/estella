// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  A connected build says which graphics API it draws through, once its
 *        game has started — a WeChat build set to EmscriptenGLX falls back to
 *        WebGL2 on most hosts, and only the device knows which it got.
 */
import { describe, it, expect, vi } from 'vitest';
import { setPlatform } from '../src/platform/base';
import type { PlatformAdapter, PlatformSocket } from '../src/platform/types';
import { graphicsPathFor, type App } from '../src/app/app';

vi.mock('../src/app/app', async (actual) => ({
    ...await actual<typeof import('../src/app/app')>(),
    graphicsPathOf: () => 'EmscriptenGLX',
}));

describe('the graphics path a device reports', () => {
    it('follows the surface the engine was given', () => {
        expect(graphicsPathFor({ kind: 'gl-context', handle: 1 })).toBe('WebGL2');
        expect(graphicsPathFor({ kind: 'gl-context', handle: 1, glx: true })).toBe('EmscriptenGLX');
        expect(graphicsPathFor({ kind: 'webgpu' })).toBe('WebGPU');
        expect(graphicsPathFor({ kind: 'default' })).toBeNull();
    });

    it('is unknown in the first hello and named in the one sent when the game starts', async () => {
        const sent: Array<{ t: string; graphics?: string | null }> = [];
        const handlers: Record<string, Array<() => void>> = {};
        const socket = {
            delivery: 'reliable-ordered', readyState: 'connecting',
            on(event: string, fn: () => void) { (handlers[event] ??= []).push(fn); return () => {}; },
            connect() {}, close() {},
            send(data: string) { sent.push(JSON.parse(data)); },
        } as unknown as PlatformSocket;
        setPlatform({ name: 'wechat', now: () => performance.now(), createSocket: () => socket } as unknown as PlatformAdapter);
        const { startDebugChannel, attachDebugChannel } = await import('../src/runtime/debugChannel');
        startDebugChannel({ url: 'ws://editor:1/?token=t' });
        (socket as { readyState: string }).readyState = 'open';
        for (const fn of handlers.open ?? []) fn();

        attachDebugChannel({ hasResource: () => false, onFrameEnd: () => () => {} } as unknown as App);
        const hellos = sent.filter((m) => m.t === 'hello');
        expect(hellos.map((h) => h.graphics)).toEqual([null, 'EmscriptenGLX']);
    });
});
