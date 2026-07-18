// GestureDetector consumes TOUCH points only (Input.touches / touchesStarted /
// touchesEnded) — mouse input never reaches it by itself. This system funnels
// two sources into a dedicated InputState that only the detector reads:
//   a) real touches that started inside the gesture pad (mobile), and
//   b) synthetic touches bridged from mouse drags (desktop): a left-drag is a
//      one-finger gesture; a Shift-drag adds a second touch mirrored across the
//      press point, which drives the detector's real two-finger pinch path.
import {
    defineSystem, Res, Time, Input, InputState, UICameraInfo, GestureDetector,
} from 'esengine';
import type { UICameraData } from 'esengine';
import { gestureState } from '../state';

/** The pad is the bottom quarter of the screen (matches the GesturePad UINode). */
const PAD_FRACTION = 0.25;
const SWIPE_STEP = 90;
const MOUSE_TOUCH = -1;
const MIRROR_TOUCH = -2;

const padInput = new InputState();
const detector = new GestureDetector(padInput);
const padTouchIds = new Set<number>();
let mouseMode: 'none' | 'swipe' | 'pinch' = 'none';
let anchorX = 0;
let anchorY = 0;
// Lifting the fingers off a pinch often travels far enough to classify as a
// swipe too; suppress swipes for the remainder of a gesture that pinched.
let pinchedThisGesture = false;

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

detector.onSwipe = (direction, speed) => {
    if (pinchedThisGesture) return;
    // Touch y grows downward, so a screen-up swipe moves the ship toward +y.
    if (direction === 'left') gestureState.stepX -= SWIPE_STEP;
    else if (direction === 'right') gestureState.stepX += SWIPE_STEP;
    else if (direction === 'up') gestureState.stepY += SWIPE_STEP;
    else gestureState.stepY -= SWIPE_STEP;
    gestureState.last = `Swipe ${direction} (${Math.round(speed)} px/s)`;
};

detector.onPinch = (scale, _centerX, _centerY) => {
    pinchedThisGesture = true;
    gestureState.scale = clamp(gestureState.scale * scale, 0.5, 2.5);
    gestureState.last = `Pinch — ship scale x${gestureState.scale.toFixed(2)}`;
};

detector.onTap = (x, y) => {
    gestureState.last = `Tap (${Math.round(x)}, ${Math.round(y)})`;
};

detector.onLongPress = () => {
    gestureState.last = 'Long press';
};

function inPad(y: number, cam: UICameraData): boolean {
    return cam.valid && cam.screenH > 0 && y >= cam.screenH * (1 - PAD_FRACTION);
}

function startTouch(id: number, x: number, y: number): void {
    const p = { id, x, y };
    padInput.touches.set(id, p);
    padInput.touchesStarted.set(id, p);
}

function moveTouch(id: number, x: number, y: number): void {
    const p = padInput.touches.get(id);
    if (p) { p.x = x; p.y = y; }
}

function endTouch(id: number): void {
    padInput.touches.delete(id);
    padInput.touchesEnded.add(id);
}

export const gestureSystem = defineSystem(
    [Res(Input), Res(UICameraInfo), Res(Time)],
    (input, cam: UICameraData, time) => {
        padInput.touchesStarted.clear();
        padInput.touchesEnded.clear();
        if (padInput.touches.size === 0) pinchedThisGesture = false;

        // a) Real touches: forward the ones that started inside the pad.
        for (const [id, t] of input.touchesStarted) {
            if (!inPad(t.y, cam)) continue;
            padTouchIds.add(id);
            startTouch(id, t.x, t.y);
        }
        for (const id of padTouchIds) {
            const live = input.touches.get(id);
            if (live) moveTouch(id, live.x, live.y);
        }
        for (const id of input.touchesEnded) {
            if (padTouchIds.delete(id)) endTouch(id);
        }

        // b) Mouse bridge.
        const mx = input.mouseX;
        const my = input.mouseY;
        if (mouseMode === 'none') {
            if (input.isMouseButtonPressed(0) && inPad(my, cam) && !input.isPointerOverUI()) {
                const shift = input.isKeyDown('ShiftLeft') || input.isKeyDown('ShiftRight');
                mouseMode = shift ? 'pinch' : 'swipe';
                anchorX = mx;
                anchorY = my;
                startTouch(MOUSE_TOUCH, mx, my);
                if (mouseMode === 'pinch') startTouch(MIRROR_TOUCH, mx, my);
            }
        } else if (input.isMouseButtonDown(0)) {
            moveTouch(MOUSE_TOUCH, mx, my);
            if (mouseMode === 'pinch') moveTouch(MIRROR_TOUCH, 2 * anchorX - mx, 2 * anchorY - my);
        } else {
            endTouch(MOUSE_TOUCH);
            if (mouseMode === 'pinch') endTouch(MIRROR_TOUCH);
            mouseMode = 'none';
        }

        detector.update(time.delta);
    },
    { name: 'GestureSystem' }
);
