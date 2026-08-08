// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
//
/**
 * @file  The web and native adapters answer ONE input contract — driven the same
 *        way, they must call InputEventCallbacks identically.
 *
 * `NativeInputListener.onKeyDown` was optional and the entry point that would
 * have fed it was never written, so no key ever reached a native game and nothing
 * said so. A per-adapter test would not have caught that: each was
 * self-consistent. Only comparing the two traces makes a missing half visible.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { webAdapter } from '../src/platform/web';
import { NativePlatformAdapter } from '../src/platform/native';
import { createHostBridge } from '../src/platform/native/hostBridge';
import type { InputEventCallbacks } from '../src/platform/types';

/** One line per callback, so a difference reads as a diff rather than a count. */
type Trace = string[];

function recorder(): { callbacks: InputEventCallbacks; trace: Trace } {
    const trace: Trace = [];
    return {
        trace,
        callbacks: {
            onKeyDown: (code) => trace.push(`keyDown ${code}`),
            onKeyUp: (code) => trace.push(`keyUp ${code}`),
            onPointerMove: (x, y) => trace.push(`pointerMove ${x},${y}`),
            onPointerDown: (b, x, y) => trace.push(`pointerDown ${b} ${x},${y}`),
            onPointerUp: (b) => trace.push(`pointerUp ${b}`),
            onWheel: (dx, dy) => trace.push(`wheel ${dx},${dy}`),
            onTouchStart: (id, x, y) => trace.push(`touchStart ${id} ${x},${y}`),
            onTouchMove: (id, x, y) => trace.push(`touchMove ${id} ${x},${y}`),
            onTouchEnd: (id) => trace.push(`touchEnd ${id}`),
            onTouchCancel: (id) => trace.push(`touchCancel ${id}`),
        },
    };
}

/** The es_* surface the bridge insists on, stubbed to the minimum. */
function hostScope(): Record<string, unknown> {
    return {
        console, setTimeout, clearTimeout, performance, TextDecoder,
        es_readAsset: () => null,
        es_loadImagePixels: () => null,
    };
}

describe('input adapter parity (web vs native)', () => {
    let element: HTMLCanvasElement;

    beforeEach(() => {
        element = document.createElement('canvas');
        element.width = 800;
        element.height = 600;
        document.body.appendChild(element);
    });

    afterEach(() => { element.remove(); });

    /**
     * The same logical actions through each adapter's own idiom: DOM events for
     * the web, the host's es_onNative* entry points for native. Both records must
     * come out identical — that identity IS the contract.
     */
    function driveWeb(): Trace {
        const { callbacks, trace } = recorder();
        const web = webAdapter;
        web.bindInputEvents(callbacks, element);

        // offsetX/offsetY are what the web adapter reads and what a layout would
        // normally compute; there is no layout here, so they are set directly.
        const mouse = (type: string, button: number, x: number, y: number) => {
            const e = new MouseEvent(type, { button, bubbles: true });
            Object.defineProperty(e, 'offsetX', { value: x });
            Object.defineProperty(e, 'offsetY', { value: y });
            return e;
        };
        element.dispatchEvent(mouse('mousedown', 2, 10, 20));
        element.dispatchEvent(mouse('mousemove', 0, 11, 21));
        // mouseup and the keys are bound to the DOCUMENT — a button released off
        // the canvas still ends the drag — so that is where they are dispatched.
        document.dispatchEvent(mouse('mouseup', 2, 0, 0));
        element.dispatchEvent(new WheelEvent('wheel', { deltaX: 0, deltaY: 48, deltaMode: 0 }));
        document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }));
        document.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW' }));

        web.unbindInputEvents();
        return trace;
    }

    function driveNative(): Trace {
        const { callbacks, trace } = recorder();
        const scope = hostScope();
        const bridge = createHostBridge(scope);
        const native = new NativePlatformAdapter(bridge);
        native.bindInputEvents(callbacks);

        type Pointer = (t: number, b: number, x: number, y: number) => void;
        (scope.es_onNativePointer as Pointer)(0, 2, 10, 20);
        (scope.es_onNativePointer as Pointer)(1, 0, 11, 21);
        (scope.es_onNativePointer as Pointer)(2, 2, 0, 0);
        (scope.es_onNativeWheel as (dx: number, dy: number) => void)(0, 48);
        (scope.es_onNativeKey as (down: boolean, code: string) => void)(true, 'KeyW');
        (scope.es_onNativeKey as (down: boolean, code: string) => void)(false, 'KeyW');

        native.unbindInputEvents();
        return trace;
    }

    it('mouse, wheel and keys produce the same callbacks on both', () => {
        const web = driveWeb();
        expect(web).toEqual([
            'pointerDown 2 10,20',
            'pointerMove 11,21',
            'pointerUp 2',
            'wheel 0,48',
            'keyDown KeyW',
            'keyUp KeyW',
        ]);
        expect(driveNative()).toEqual(web);
    });

    it('a native mouse does NOT go through the touch pointer synthesizer', () => {
        // Routing it there is the obvious shortcut and it silently drops every
        // button but the left one, because the synthesizer reports pointer 0.
        const { callbacks, trace } = recorder();
        const scope = hostScope();
        const native = new NativePlatformAdapter(createHostBridge(scope));
        native.bindInputEvents(callbacks);

        (scope.es_onNativePointer as (t: number, b: number, x: number, y: number) => void)(0, 1, 5, 6);
        expect(trace).toEqual(['pointerDown 1 5,6']);
        expect(trace.some((line) => line.startsWith('touch'))).toBe(false);
    });

    it('touch still synthesizes the primary pointer, as it does on the web', () => {
        const { callbacks, trace } = recorder();
        const scope = hostScope();
        const native = new NativePlatformAdapter(createHostBridge(scope));
        native.bindInputEvents(callbacks);

        type Touch = (t: number, id: number, x: number, y: number) => void;
        (scope.es_onNativeTouch as Touch)(0, 7, 30, 40);
        (scope.es_onNativeTouch as Touch)(1, 7, 31, 41);
        (scope.es_onNativeTouch as Touch)(2, 7, 0, 0);
        expect(trace).toEqual([
            'touchStart 7 30,40',
            'pointerDown 0 30,40',
            'touchMove 7 31,41',
            'pointerMove 31,41',
            'touchEnd 7',
            'pointerUp 0',
        ]);
    });

    it('gamepads read as the standard mapping, or as none', () => {
        const scope = hostScope();
        expect(new NativePlatformAdapter(createHostBridge(scope)).pollGamepads()).toEqual([]);

        scope.es_pollGamepads = () => [{
            index: 0, connected: true,
            buttons: new Array(17).fill(0), axes: [0, 0, 0, 0],
        }];
        const pads = new NativePlatformAdapter(createHostBridge(scope)).pollGamepads();
        expect(pads).toHaveLength(1);
        expect(pads[0].mapping).toBe('standard');
        expect(pads[0].buttons).toHaveLength(17);
        expect(pads[0].axes).toHaveLength(4);
    });
});
