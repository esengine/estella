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
import { InputState, inputEventCallbacks } from '../src/input/input';
import type { InputEventCallbacks } from '../src/platform/types';

/** One line per callback, so a difference reads as a diff rather than a count. */
type Trace = string[];

function recorder(): { callbacks: InputEventCallbacks; trace: Trace } {
    const trace: Trace = [];
    return {
        trace,
        callbacks: {
            onKeyDown: (code) => { trace.push(`keyDown ${code}`); },
            onKeyUp: (code) => trace.push(`keyUp ${code}`),
            onPointerMove: (x, y, dx, dy) => trace.push(`pointerMove ${x},${y}${dx === undefined ? '' : ` delta ${dx},${dy}`}`),
            onPointerDown: (b, x, y) => trace.push(`pointerDown ${b} ${x},${y}`),
            onPointerUp: (b, x, y) => trace.push(`pointerUp ${b}${x === undefined ? '' : ` at ${x},${y}`}`),
            onWheel: (dx, dy, x, y) => trace.push(`wheel ${dx},${dy}${x === undefined ? '' : ` at ${x},${y}`}`),
            onTouchStart: (id, x, y) => trace.push(`touchStart ${id} ${x},${y}`),
            onTouchMove: (id, x, y) => trace.push(`touchMove ${id} ${x},${y}`),
            onTouchEnd: (id, x, y) => trace.push(`touchEnd ${id}${x === undefined ? '' : ` at ${x},${y}`}`),
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
        element.getBoundingClientRect = () => new DOMRect(10, 15, 800, 600);
        web.bindInputEvents(callbacks, element);

        // offsetX/offsetY are what the web adapter reads and what a layout would
        // normally compute; there is no layout here, so they are set directly.
        const mouse = (type: string, button: number, x: number, y: number, dx = 0, dy = 0, offsetX = x) => {
            const e = new MouseEvent(type, { button, bubbles: true, clientX: x + 10, clientY: y + 15 });
            Object.defineProperty(e, 'offsetX', { value: offsetX });
            Object.defineProperty(e, 'offsetY', { value: y });
            Object.defineProperty(e, 'movementX', { value: dx });
            Object.defineProperty(e, 'movementY', { value: dy });
            return e;
        };
        const outside = document.body.appendChild(document.createElement('div'));
        outside.addEventListener('mousemove', e => e.stopPropagation());
        outside.addEventListener('mouseup', e => e.stopPropagation());
        try {
            outside.dispatchEvent(mouse('mousemove', 0, 820, 15));
            element.dispatchEvent(mouse('mousedown', 2, 10, 20));
            element.dispatchEvent(mouse('mousemove', 0, 11, 21, 4, -3));
            // Here offsetX belongs to the sibling, not the bound canvas.
            outside.dispatchEvent(mouse('mousemove', 0, 830, 21, 7, 0, 20));
            outside.dispatchEvent(mouse('mouseup', 2, 842, 24));
            outside.dispatchEvent(mouse('mousemove', 0, 850, 28));
            for (const [deltaY, x, y] of [[48, 120, 30], [-16, 130, 40]]) {
                const wheel = new WheelEvent('wheel', { deltaY, clientX: x + 10, clientY: y + 15 });
                Object.defineProperties(wheel, { offsetX: { value: x }, offsetY: { value: y } });
                element.dispatchEvent(wheel);
            }
            document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }));
            document.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW' }));
        } finally {
            outside.remove();
            web.unbindInputEvents();
        }
        return trace;
    }

    function driveNative(): Trace {
        const { callbacks, trace } = recorder();
        const scope = hostScope();
        const bridge = createHostBridge(scope);
        const native = new NativePlatformAdapter(bridge);
        native.bindInputEvents(callbacks);

        type Pointer = (t: number, b: number, x: number, y: number, dx?: number, dy?: number) => void;
        (scope.es_onNativePointer as Pointer)(0, 2, 10, 20);
        (scope.es_onNativePointer as Pointer)(1, 0, 11, 21, 4, -3);
        (scope.es_onNativePointer as Pointer)(1, 0, 830, 21, 7, 0);
        (scope.es_onNativePointer as Pointer)(2, 2, 842, 24);
        type Wheel = (dx: number, dy: number, x: number, y: number) => void;
        (scope.es_onNativeWheel as Wheel)(0, 48, 120, 30);
        (scope.es_onNativeWheel as Wheel)(0, -16, 130, 40);
        (scope.es_onNativeKey as (down: boolean, code: string) => void)(true, 'KeyW');
        (scope.es_onNativeKey as (down: boolean, code: string) => void)(false, 'KeyW');

        native.unbindInputEvents();
        return trace;
    }

    it('mouse, wheel and keys produce the same callbacks on both', () => {
        const web = driveWeb();
        expect(web).toEqual([
            'pointerDown 2 10,20',
            'pointerMove 11,21 delta 4,-3',
            'pointerMove 830,21 delta 7,0',
            'pointerUp 2 at 842,24',
            'wheel 0,48 at 120,30',
            'wheel 0,-16 at 130,40',
            'keyDown KeyW',
            'keyUp KeyW',
        ]);
        expect(driveNative()).toEqual(web);
    });

    it('keeps a native wheel event from an older host usable without a position', () => {
        const scope = hostScope();
        const native = new NativePlatformAdapter(createHostBridge(scope));
        const input = new InputState();
        input.mouseX = 19;
        input.mouseY = 23;
        native.bindInputEvents(inputEventCallbacks(input));
        try {
            (scope.es_onNativeWheel as (dx: number, dy: number) => void)(2, 48);
            expect(input.getMousePosition()).toEqual({ x: 19, y: 23 });
            expect(input.getScrollDelta()).toEqual({ x: 2, y: 48 });
        } finally { native.unbindInputEvents(); }
    });

    it('uses the wheel position before any pointer move on a scaled browser canvas', () => {
        const input = new InputState();
        const event = new WheelEvent('wheel', { deltaY: 1, deltaMode: 1, clientX: 180, clientY: 123 });
        Object.defineProperties(event, { offsetX: { value: 80 }, offsetY: { value: 44.5 } });
        webAdapter.bindInputEvents(inputEventCallbacks(input), element);
        try {
            element.dispatchEvent(event);
            expect(input.getMousePosition()).toEqual({ x: 80, y: 44.5 });
            expect(input.getMouseDelta()).toEqual({ x: 0, y: 0 });
            expect(input.getScrollDelta()).toEqual({ x: 0, y: 16 });
        } finally { webAdapter.unbindInputEvents(); }
    });

    it.each([[1, 1], [2, 1.5]])('keeps mouse and touch in canvas coordinates with borders and scale %s × %s', (scaleX, scaleY) => {
        const { callbacks, trace } = recorder();
        const outside = document.body.appendChild(document.createElement('div'));
        Object.defineProperties(element, {
            offsetWidth: { value: 210 }, offsetHeight: { value: 108 },
            clientLeft: { value: 5 }, clientTop: { value: 4 },
        });
        element.getBoundingClientRect = () => new DOMRect(30, 40, 210 * scaleX, 108 * scaleY);
        const client = (x: number, y: number) => ({ clientX: 30 + (x + 5) * scaleX, clientY: 40 + (y + 4) * scaleY });
        const mouse = (type: string, target: HTMLElement, x: number, y: number) => {
            const e = new MouseEvent(type, { bubbles: true, ...client(x, y) });
            Object.defineProperties(e, {
                offsetX: { value: target === element ? x : 3 },
                offsetY: { value: target === element ? y : 6 },
            });
            target.dispatchEvent(e);
        };
        const touch = (type: string, x: number, y: number) => {
            const e = new Event(type, { cancelable: true });
            Object.defineProperty(e, 'changedTouches', { value: [{ identifier: 9, ...client(x, y) }] });
            element.dispatchEvent(e);
        };
        webAdapter.bindInputEvents(callbacks, element);
        try {
            mouse('mousedown', element, 20, 15);
            mouse('mousemove', outside, 220, 18);
            mouse('mouseup', outside, 225, 19);
            mouse('mousedown', element, 20, 15);
            mouse('mouseup', element, 20, 15);
            touch('touchstart', 20, 15);
            touch('touchmove', 220, 18);
            touch('touchend', 225, 19);
        } finally {
            webAdapter.unbindInputEvents();
            outside.remove();
        }
        expect(trace).toEqual([
            'pointerDown 0 20,15', 'pointerMove 220,18 delta 0,0', 'pointerUp 0 at 225,19',
            'pointerDown 0 20,15', 'pointerUp 0 at 20,15',
            'touchStart 9 20,15', 'pointerDown 0 20,15',
            'touchMove 9 220,18', 'pointerMove 220,18',
            'touchEnd 9 at 225,19', 'pointerUp 0 at 225,19',
        ]);
    });

    it.each(['content-box', 'border-box'])('maps touch and outside mouse to fractional canvas offsets with %s sizing', boxSizing => {
        const outside = document.body.appendChild(document.createElement('div'));
        Object.assign(element.style, {
            boxSizing, width: boxSizing === 'border-box' ? '210.5px' : '195.5px',
            height: boxSizing === 'border-box' ? '108.5px' : '95.5px', border: 'solid', padding: '2.25px',
            borderLeftWidth: '5.25px', borderRightWidth: '5.25px',
            borderTopWidth: '4.25px', borderBottomWidth: '4.25px',
        });
        Object.defineProperties(element, {
            offsetWidth: { value: 211 }, offsetHeight: { value: 109 },
            clientLeft: { value: 5 }, clientTop: { value: 4 },
        });
        element.getBoundingClientRect = () => new DOMRect(30, 40, 421, 162.75);
        const { callbacks, trace } = recorder();
        const position = { clientX: 30 + (220 + 5.25) * 2, clientY: 40 + (19 + 4.25) * 1.5 };
        const down = new MouseEvent('mousedown', { button: 0 });
        Object.defineProperties(down, { offsetX: { value: 20 }, offsetY: { value: 15 } });
        const touch = new Event('touchstart', { cancelable: true });
        Object.defineProperty(touch, 'changedTouches', {
            value: [{ identifier: 9, clientX: 30 + (20 + 5.25) * 2, clientY: 40 + (15 + 4.25) * 1.5 }],
        });
        webAdapter.bindInputEvents(callbacks, element);
        try {
            element.dispatchEvent(down);
            outside.dispatchEvent(new MouseEvent('mouseup', { button: 0, bubbles: true, ...position }));
            element.dispatchEvent(touch);
        } finally {
            webAdapter.unbindInputEvents();
            outside.remove();
        }
        expect(trace).toEqual([
            'pointerDown 0 20,15', 'pointerUp 0 at 220,19', 'touchStart 9 20,15', 'pointerDown 0 20,15',
            'touchCancel 9', 'pointerUp 0',
        ]);
    });

    it('reports the same mouse cancellation on web blur and native hide', () => {
        const web = recorder(), native = recorder();
        web.callbacks.onPointerCancel = button => web.trace.push(`cancel ${button}`);
        native.callbacks.onPointerCancel = button => native.trace.push(`cancel ${button}`);
        const scope = hostScope();
        const adapter = new NativePlatformAdapter(createHostBridge(scope));
        webAdapter.bindInputEvents(web.callbacks, element);
        adapter.bindInputEvents(native.callbacks);
        try {
            const down = new MouseEvent('mousedown', { button: 2, bubbles: true });
            Object.defineProperties(down, { offsetX: { value: 0 }, offsetY: { value: 0 } });
            element.dispatchEvent(down);
            window.dispatchEvent(new Event('blur'));
            element.dispatchEvent(new MouseEvent('mouseup', { button: 2, bubbles: true }));

            const pointer = scope.es_onNativePointer as (type: number, button: number, x: number, y: number) => void;
            pointer(0, 2, 0, 0);
            (scope.es_onNativeVisibility as (visible: boolean) => void)(false);
            pointer(2, 2, 0, 0);
            expect(native.trace).toEqual(web.trace);
            expect(native.trace).toEqual(['pointerDown 2 0,0', 'cancel 2']);
        } finally {
            webAdapter.unbindInputEvents();
            adapter.unbindInputEvents();
        }
    });

    it('accumulates native relative motion even when the cursor is stationary', () => {
        const scope = hostScope();
        const native = new NativePlatformAdapter(createHostBridge(scope));
        const input = new InputState();
        native.bindInputEvents(inputEventCallbacks(input));
        try {
            const move = scope.es_onNativePointer as (t: number, b: number, x: number, y: number, dx?: number, dy?: number) => void;
            move(1, 0, 400, 300, 4, -3);
            move(1, 0, 400, 300, -1, 2);
            // An older host still reports the pointer's position with four arguments.
            move(1, 0, 402, 301);
            expect(input.getMousePosition()).toEqual({ x: 402, y: 301 });
            expect(input.getMouseDelta()).toEqual({ x: 3, y: -1 });
        } finally { native.unbindInputEvents(); }
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
        (scope.es_onNativeTouch as Touch)(2, 7, 36, 45);
        expect(trace).toEqual([
            'touchStart 7 30,40',
            'pointerDown 0 30,40',
            'touchMove 7 31,41',
            'pointerMove 31,41',
            'touchEnd 7 at 36,45',
            'pointerUp 0 at 36,45',
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
