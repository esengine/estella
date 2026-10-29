// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    cocos/input.ts
 * @brief   Touch events on nodes: `Node.on(TOUCH_START, ...)`, `EventTouch`, and the system that raises them.
 *
 * The engine already turns the mouse and fingers into one list of pointers each frame (`uiPointersOf`) and knows the camera that
 * maps a screen point to the world. What Cocos adds is who gets told: a touch is claimed at its start by the TOPMOST node that
 * listens for touches and whose rectangle holds the point, the rest of the gesture (move, end, cancel) goes to that same node
 * wherever the finger has gone, and the event then bubbles up through the node's ancestors, each of which hears it without being
 * hit-tested, until one stops it.
 *
 * A touch's location is a world point. In an imported scene the engine's world and Cocos's are the same space (the canvas sits where
 * it sat, the camera is where it was), so a script's `getUILocation()` and `convertToNodeSpaceAR` mean what they meant.
 */
import { Schedule, defineSystem, addSystemToSchedule, GetWorld } from '../ecs/system';
import { Res } from '../ecs/resource';
import { Input, type InputState } from '../input/input';
import { uiPointersOf } from '../ui/input/pointerBook';
import { UICameraInfo, type UICameraData } from '../ui/core/ui-camera-info';
import { screenToUiWorld } from '../ui/util/ui-pick';
import { platformDevicePixelRatio } from '../platform';
import type { World } from '../ecs/world';
import type { Entity } from '../types';
import { Children, Parent } from '../ecs/component';
import { Vec2 } from './math';
import { Node, touchListeningEntities } from './node';
import { UITransform } from './ui/uiTransform';
import { log } from '../util/logger';
import { EventKeyboard, EventMouse, input as globalInput, keyCodeOf, Input as InputApi } from './inputApi';

/** One finger (or the mouse button) as a script sees it. */
export class Touch {
    constructor(
        public readonly id: number,
        private x_: number,
        private y_: number,
        private readonly startX_: number = x_,
        private readonly startY_: number = y_,
        private prevX_: number = x_,
        private prevY_: number = y_,
    ) {}

    /** @internal */
    _move(x: number, y: number): void { this.prevX_ = this.x_; this.prevY_ = this.y_; this.x_ = x; this.y_ = y; }

    getID(): number { return this.id; }
    getLocation(out: Vec2 = new Vec2()): Vec2 { return out.set(this.x_, this.y_); }
    getLocationX(): number { return this.x_; }
    getLocationY(): number { return this.y_; }
    /** The canvas-space point: in an imported scene the same space as the world, see the file comment. */
    getUILocation(out: Vec2 = new Vec2()): Vec2 { return out.set(this.x_, this.y_); }
    getUILocationX(): number { return this.x_; }
    getUILocationY(): number { return this.y_; }
    getStartLocation(out: Vec2 = new Vec2()): Vec2 { return out.set(this.startX_, this.startY_); }
    getPreviousLocation(out: Vec2 = new Vec2()): Vec2 { return out.set(this.prevX_, this.prevY_); }
    getDelta(out: Vec2 = new Vec2()): Vec2 { return out.set(this.x_ - this.prevX_, this.y_ - this.prevY_); }
}

/** The event a touch listener receives. */
export class EventTouch {
    /** Always bubbles, as in Cocos. */
    readonly bubbles = true;
    target: Node | null = null;
    currentTarget: Node | null = null;
    private stopped_ = false;

    constructor(public readonly type: string, public readonly touch: Touch, private readonly all_: Touch[]) {}

    get propagationStopped(): boolean { return this.stopped_; }
    stopPropagation(): void { this.stopped_ = true; }
    stopPropagationImmediate(): void { this.stopped_ = true; }
    getTouches(): Touch[] { return this.all_; }

    getID(): number { return this.touch.id; }
    getLocation(out?: Vec2): Vec2 { return this.touch.getLocation(out); }
    getLocationX(): number { return this.touch.getLocationX(); }
    getLocationY(): number { return this.touch.getLocationY(); }
    getUILocation(out?: Vec2): Vec2 { return this.touch.getUILocation(out); }
    getUILocationX(): number { return this.touch.getUILocationX(); }
    getUILocationY(): number { return this.touch.getUILocationY(); }
    getStartLocation(out?: Vec2): Vec2 { return this.touch.getStartLocation(out); }
    getPreviousLocation(out?: Vec2): Vec2 { return this.touch.getPreviousLocation(out); }
    getDelta(out?: Vec2): Vec2 { return this.touch.getDelta(out); }
}

// ---------------------------------------------------------------------------------------------------------------------
// Which node is on top.
// ---------------------------------------------------------------------------------------------------------------------

/** Where a node stands in draw order, as the sibling indices from the root: a later sibling, or a descendant, is above. */
function orderKey(world: World, entity: Entity): number[] {
    const path: number[] = [];
    let current: Entity = entity;
    for (;;) {
        const parent: Entity | undefined = world.tryGet(current, Parent)?.entity;
        if (!parent) { path.push(Number(current)); break; }
        path.push(world.tryGet(parent, Children)?.entities.indexOf(current) ?? 0);
        current = parent;
    }
    return path.reverse();
}

/** Higher draw order first. */
function compareTopmost(a: number[], b: number[]): number {
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) if (a[i] !== b[i]) return b[i]! - a[i]!;
    return b.length - a.length;   // a descendant is above its ancestor
}

const TOUCH_TYPES = [Node.EventType.TOUCH_START, Node.EventType.TOUCH_MOVE, Node.EventType.TOUCH_END, Node.EventType.TOUCH_CANCEL];

function listensForTouch(node: Node): boolean {
    for (const t of TOUCH_TYPES) if (node.hasEventListener(t)) return true;
    return false;
}

/** The topmost active node that listens for touches and holds @p point, or null. */
function hitNode(world: World, point: Vec2): Node | null {
    const hits: Array<{ node: Node; key: number[] }> = [];
    for (const entity of touchListeningEntities(world)) {
        if (!world.valid(entity)) continue;
        const node = Node.for(world, entity);
        if (!listensForTouch(node) || !node.activeInHierarchy) continue;
        const transform = node.getComponent(UITransform);
        if (!transform || !transform.isHit(point)) continue;
        hits.push({ node, key: orderKey(world, entity) });
    }
    if (hits.length === 0) return null;
    hits.sort((a, b) => compareTopmost(a.key, b.key));
    return hits[0]!.node;
}

/** Hand an event to a node and its ancestors, nearest first, until one stops it. */
function dispatch(event: EventTouch, from: Node): void {
    event.target = from;
    for (let node: Node | null = from; node && !event.propagationStopped; node = node.parent) {
        event.currentTarget = node;
        if (!node.hasEventListener(event.type)) continue;
        try {
            node.emit(event.type, event);
        } catch (err) {
            log.error('cocos', `${node.name} ${event.type} listener threw`, err);
        }
    }
}

// ---------------------------------------------------------------------------------------------------------------------
// The per-frame system.
// ---------------------------------------------------------------------------------------------------------------------

interface Gesture { touch: Touch; target: Node | null }
const gestures = new WeakMap<World, Map<number, Gesture>>();

function gesturesOf(world: World): Map<number, Gesture> {
    let g = gestures.get(world);
    if (!g) gestures.set(world, (g = new Map()));
    return g;
}

/** Turn this frame's pointers into TOUCH_START / MOVE / END events. Exported so a test (or a host with its own loop) can drive it. */
export function pumpTouches(world: World, input: InputState, camera: UICameraData): void {
    const book = gesturesOf(world);
    const dpr = platformDevicePixelRatio();
    const surfaceH = camera.screenH;
    const pointers = uiPointersOf(input);
    const live = [...book.values()].map((g) => g.touch);

    for (const p of pointers) {
        const at = camera.valid ? screenToUiWorld(camera, p.x * dpr, surfaceH - p.y * dpr) : { x: 0, y: 0 };
        let gesture = book.get(p.id);

        if (p.pressed && !gesture) {
            const touch = new Touch(p.id, at.x, at.y);
            gesture = { touch, target: hitNode(world, new Vec2(at.x, at.y)) };
            book.set(p.id, gesture);
            live.push(touch);
            globalInput.emit(Node.EventType.TOUCH_START, new EventTouch(Node.EventType.TOUCH_START, touch, live));
            if (gesture.target) dispatch(new EventTouch(Node.EventType.TOUCH_START, touch, live), gesture.target);
        }
        if (!gesture) continue;

        if (p.down && (at.x !== gesture.touch.getLocationX() || at.y !== gesture.touch.getLocationY())) {
            gesture.touch._move(at.x, at.y);
            globalInput.emit(Node.EventType.TOUCH_MOVE, new EventTouch(Node.EventType.TOUCH_MOVE, gesture.touch, live));
            if (gesture.target) dispatch(new EventTouch(Node.EventType.TOUCH_MOVE, gesture.touch, live), gesture.target);
        }
        if (p.released) {
            gesture.touch._move(at.x, at.y);
            const type = p.cancelled ? Node.EventType.TOUCH_CANCEL : Node.EventType.TOUCH_END;
            globalInput.emit(type, new EventTouch(type, gesture.touch, live));
            if (gesture.target) dispatch(new EventTouch(type, gesture.touch, live), gesture.target);
            book.delete(p.id);
        }
    }
}

// ---------------------------------------------------------------------------------------------------------------------
// Keyboard and mouse, to the global `input`.
// ---------------------------------------------------------------------------------------------------------------------

/** Where each input state's mouse was last frame, so a move is a change and the first frame is not one. */
const lastMouseOf = new WeakMap<InputState, { x: number; y: number }>();

/** Turn this frame's key, button and wheel state into events on the global `input`. Touches are `pumpTouches`'s. */
export function pumpKeysAndMouse(input: InputState, camera: UICameraData): void {
    for (const code of input.keysPressed) globalInput.emit(InputApi.EventType.KEY_DOWN, new EventKeyboard(keyCodeOf(code), InputApi.EventType.KEY_DOWN));
    for (const code of input.keysDown) {
        if (!input.keysPressed.has(code)) globalInput.emit(InputApi.EventType.KEY_PRESSING, new EventKeyboard(keyCodeOf(code), InputApi.EventType.KEY_PRESSING));
    }
    for (const code of input.keysReleased) globalInput.emit(InputApi.EventType.KEY_UP, new EventKeyboard(keyCodeOf(code), InputApi.EventType.KEY_UP));

    const dpr = platformDevicePixelRatio();
    const at = camera.valid ? screenToUiWorld(camera, input.mouseX * dpr, camera.screenH - input.mouseY * dpr) : { x: 0, y: 0 };
    const lastMouse = lastMouseOf.get(input);
    const previous = lastMouse ?? at;
    const moved = lastMouse !== undefined && (at.x !== lastMouse.x || at.y !== lastMouse.y);
    const prev = new Vec2(previous.x, previous.y);
    const event = (type: string): EventMouse => new EventMouse(type, at.x, at.y, prev);
    for (const b of input.mouseButtonsPressed) globalInput.emit(InputApi.EventType.MOUSE_DOWN, event(InputApi.EventType.MOUSE_DOWN)._button(b));
    if (moved) globalInput.emit(InputApi.EventType.MOUSE_MOVE, event(InputApi.EventType.MOUSE_MOVE));
    for (const b of input.mouseButtonsReleased) globalInput.emit(InputApi.EventType.MOUSE_UP, event(InputApi.EventType.MOUSE_UP)._button(b));
    if (input.scrollDeltaX !== 0 || input.scrollDeltaY !== 0) {
        // Cocos reports a wheel turned away from the player as positive; a DOM delta is the other way.
        globalInput.emit(InputApi.EventType.MOUSE_WHEEL, event(InputApi.EventType.MOUSE_WHEEL)._scroll(-input.scrollDeltaX, -input.scrollDeltaY));
    }
    lastMouseOf.set(input, { x: at.x, y: at.y });
}

/** Register the touch system with the engine's frame loop. Idempotent per context is the caller's business: see `declareBuiltinScripts`. */
export function declareInputSystem(): void {
    const system = defineSystem(
        [Res(Input), Res(UICameraInfo), GetWorld()],
        (input, camera, world) => { pumpTouches(world, input, camera); pumpKeysAndMouse(input, camera); },
        { name: 'Cocos:Input', touches: { opaque: true } },
    );
    addSystemToSchedule(Schedule.PreUpdate, system);
}
