// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    cocos/input.ts
 * @brief   Touch events on nodes: `Node.on(TOUCH_START, ...)`, `EventTouch`, and the translation from the engine's pointer events.
 *
 * The engine already decides who a pointer is on (the topmost interactable under it), lets that entity hold the gesture, and says
 * what happens to it: `press`, `pointer_move`, `release`, `press_cancel`, each with where the pointer is. A node that listens for
 * touches is made interactable, and those events are handed to it here as Cocos's: the touch starts on the topmost listening node,
 * the rest of the gesture goes to that same node wherever the finger goes, and the event travels the node's ancestors — the
 * capture listeners from the top down, then the target's own, then the bubbling ones back up — until one stops it.
 *
 * Because it is the engine's pointer, a touch on a Cocos node also counts as "over the UI" for gameplay input, and anything the
 * engine's own UI does with pointers (hover, focus) sees these nodes too.
 *
 * A touch has two places, as in Cocos: the SCREEN point (`getLocation`, the surface in pixels from its bottom-left corner — what a
 * camera's `screenToWorld` takes) and the CANVAS point (`getUILocation`, where the UI is laid out; in an imported scene, the world).
 */
import { Schedule, defineSystem, addSystemToSchedule, GetWorld } from '../ecs/system';
import { Res } from '../ecs/resource';
import { Input, type InputState } from '../input/input';
import { EntityEvents, type EntityEvent, type EntityEventQueue } from '../ecs/entityEvents';
import { UIEventType } from '../ui/core/events';
import { UIControlPointers, type ControlPointer, type UIControlPointersData, type UiPointerEventData } from '../ui/input/control-pointers';
import { Interactable } from '../ui/input/interactable';
import { MOUSE_POINTER, uiPointersOf } from '../ui/input/pointerBook';
import { SystemLabel } from '../ecs/systemLabels';
import type { World } from '../ecs/world';
import type { Entity } from '../types';
import { Vec2 } from './math';
import { Node, touchListeningEntities } from './node';
import { ensureUITransform } from './ui/uiTransform';
import { log } from '../util/logger';
import { EventKeyboard, EventMouse, input as globalInput, keyCodeOf, Input as InputApi } from './inputApi';

interface Point { x: number; y: number; sx: number; sy: number }

/**
 * One finger (or the mouse button) as a script sees it, at two kinds of place as in Cocos: the SCREEN point
 * (`getLocation`: pixels of the drawing surface, origin bottom-left — what a camera's `screenToWorld` takes), and the CANVAS point
 * (`getUILocation`: the space the UI is laid out in, which in an imported scene is the world's).
 */
export class Touch {
    private cur_: Point;
    private readonly start_: Point;
    private prev_: Point;

    constructor(public readonly id: number, x: number, y: number, sx: number = x, sy: number = y) {
        this.cur_ = { x, y, sx, sy };
        this.start_ = { ...this.cur_ };
        this.prev_ = { ...this.cur_ };
    }

    /** @internal */
    _move(x: number, y: number, sx: number = x, sy: number = y): void { this.prev_ = this.cur_; this.cur_ = { x, y, sx, sy }; }

    getID(): number { return this.id; }

    getLocation(out: Vec2 = new Vec2()): Vec2 { return out.set(this.cur_.sx, this.cur_.sy); }
    getLocationX(): number { return this.cur_.sx; }
    getLocationY(): number { return this.cur_.sy; }
    getStartLocation(out: Vec2 = new Vec2()): Vec2 { return out.set(this.start_.sx, this.start_.sy); }
    getPreviousLocation(out: Vec2 = new Vec2()): Vec2 { return out.set(this.prev_.sx, this.prev_.sy); }
    getDelta(out: Vec2 = new Vec2()): Vec2 { return out.set(this.cur_.sx - this.prev_.sx, this.cur_.sy - this.prev_.sy); }

    getUILocation(out: Vec2 = new Vec2()): Vec2 { return out.set(this.cur_.x, this.cur_.y); }
    getUILocationX(): number { return this.cur_.x; }
    getUILocationY(): number { return this.cur_.y; }
    getUIStartLocation(out: Vec2 = new Vec2()): Vec2 { return out.set(this.start_.x, this.start_.y); }
    getUIPreviousLocation(out: Vec2 = new Vec2()): Vec2 { return out.set(this.prev_.x, this.prev_.y); }
    getUIDelta(out: Vec2 = new Vec2()): Vec2 { return out.set(this.cur_.x - this.prev_.x, this.cur_.y - this.prev_.y); }
}

/** The event a touch listener receives. */
export class EventTouch {
    /** Always bubbles, as in Cocos. */
    readonly bubbles = true;
    target: Node | null = null;
    currentTarget: Node | null = null;
    private stopped_ = false;
    /** @internal Set by the dispatcher: cancels the touch for the node that claimed it. */
    _cancelTarget: (() => void) | null = null;

    constructor(public readonly type: string, public readonly touch: Touch, private readonly all_: Touch[]) {}

    /**
     * Tell the node the touch started on that it is cancelled, and stop sending it the rest of the gesture. A scroll view calls this
     * once a drag is clearly a drag, so a button under the finger does not also click when it is lifted.
     */
    cancelInner(): void { this._cancelTarget?.(); }

    get propagationStopped(): boolean { return this.stopped_; }
    stopPropagation(): void { this.stopped_ = true; }
    stopPropagationImmediate(): void { this.stopped_ = true; }
    getTouches(): Touch[] { return this.all_; }

    getID(): number { return this.touch.id; }
    getLocation(out?: Vec2): Vec2 { return this.touch.getLocation(out); }
    getLocationX(): number { return this.touch.getLocationX(); }
    getLocationY(): number { return this.touch.getLocationY(); }
    getUILocation(out?: Vec2): Vec2 { return this.touch.getUILocation(out); }
    getUIStartLocation(out?: Vec2): Vec2 { return this.touch.getUIStartLocation(out); }
    getUIPreviousLocation(out?: Vec2): Vec2 { return this.touch.getUIPreviousLocation(out); }
    getUIDelta(out?: Vec2): Vec2 { return this.touch.getUIDelta(out); }
    getUILocationX(): number { return this.touch.getUILocationX(); }
    getUILocationY(): number { return this.touch.getUILocationY(); }
    getStartLocation(out?: Vec2): Vec2 { return this.touch.getStartLocation(out); }
    getPreviousLocation(out?: Vec2): Vec2 { return this.touch.getPreviousLocation(out); }
    getDelta(out?: Vec2): Vec2 { return this.touch.getDelta(out); }
}

// ---------------------------------------------------------------------------------------------------------------------
// Making listening nodes interactable.
// ---------------------------------------------------------------------------------------------------------------------

/** The entities this layer has made interactable, per world, so it can take the mark away again from ones that stopped listening. */
const equipped = new WeakMap<World, Set<Entity>>();

/**
 * A node that listens for touches is a thing a pointer can land on: it gets a rectangle (the node's `UITransform`) and the engine's
 * `Interactable`, which lets events pass through to its ancestors (the bubbling here is the node tree's, not the engine's). A node
 * that stops listening gives the mark back, so it does not keep catching touches that belong to what is under it.
 */
function syncInteractables(world: World): void {
    const have = equipped.get(world) ?? new Set<Entity>();
    equipped.set(world, have);
    const want = new Set<Entity>();
    for (const entity of touchListeningEntities(world)) if (world.valid(entity)) want.add(entity);
    for (const entity of want) {
        if (have.has(entity)) continue;
        ensureUITransform(world, entity);
        if (!world.has(entity, Interactable)) world.insert(entity, Interactable, { enabled: true, blockRaycast: false, raycastTarget: true });
        have.add(entity);
    }
    for (const entity of [...have]) {
        if (want.has(entity)) continue;
        have.delete(entity);
        if (world.valid(entity) && world.has(entity, Interactable)) world.remove(entity, Interactable);
    }
}

// ---------------------------------------------------------------------------------------------------------------------
// Delivering a touch: capture down, target, bubble up.
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Hand an event down and up the node tree: the capture listeners of the ancestors from the top, then the target's own capture and
 * normal listeners, then the normal listeners from the target's parent up, until one stops it.
 */
function dispatch(event: EventTouch, target: Node): void {
    const path: Node[] = [];
    for (let n: Node | null = target; n; n = n.parent) path.unshift(n);
    event.target = target;
    const guard = (fn: () => void, node: Node): void => {
        try { fn(); } catch (err) { log.error('cocos', `${node.name} ${event.type} listener threw`, err); }
    };
    for (const node of path) {
        if (event.propagationStopped) return;
        event.currentTarget = node;
        guard(() => node._emitCapture(event.type, event), node);
    }
    for (let node: Node | null = target; node && !event.propagationStopped; node = node.parent) {
        event.currentTarget = node;
        if (!node.hasEventListener(event.type, false)) continue;
        guard(() => node!.emit(event.type, event), node);
    }
}

const TO_COCOS: Record<string, string> = {
    [UIEventType.Press]: Node.EventType.TOUCH_START,
    [UIEventType.PointerMove]: Node.EventType.TOUCH_MOVE,
    [UIEventType.Release]: Node.EventType.TOUCH_END,
    [UIEventType.PressCancel]: Node.EventType.TOUCH_CANCEL,
};

interface TouchState { nodeTouches: Map<number, Touch>; globalTouches: Map<number, Touch>; subscribed: WeakSet<object> }
const states = new WeakMap<World, TouchState>();
const stateOf = (world: World): TouchState => {
    let s = states.get(world);
    if (!s) states.set(world, (s = { nodeTouches: new Map(), globalTouches: new Map(), subscribed: new WeakSet() }));
    return s;
};

/** Turn one of the engine's pointer events on an entity into the Cocos touch event for its node. */
function onPointerEvent(world: World, controls: UIControlPointersData, e: EntityEvent): void {
    // an engine event bubbles to interactable ancestors as copies; the node tree does its own bubbling, from the original only
    if (e.currentTarget !== e.target) return;
    const type = TO_COCOS[e.type];
    const data = e.data as UiPointerEventData | undefined;
    if (!type || !data || !world.valid(e.target)) return;
    const { nodeTouches } = stateOf(world);
    let touch = nodeTouches.get(data.pointer);
    if (!touch || type === Node.EventType.TOUCH_START) {
        touch = new Touch(data.pointer, data.worldX, data.worldY, data.screenX, data.screenY);
        nodeTouches.set(data.pointer, touch);
    } else {
        touch._move(data.worldX, data.worldY, data.screenX, data.screenY);
    }
    const event = new EventTouch(type, touch, [...nodeTouches.values()]);
    // giving the gesture to the node that is cancelling it (the one whose capture listener is running)
    event._cancelTarget = () => {
        const taker = event.currentTarget;
        if (taker && taker !== event.target) controls.cancelHold(data.pointer, taker._entity);
    };
    dispatch(event, Node.for(world, e.target));
    if (event.propagationStopped) e.stopPropagation();
    if (type === Node.EventType.TOUCH_END || type === Node.EventType.TOUCH_CANCEL) {
        // a cancel that hands the gesture to another node does not end the touch
        if (!controls.pointers.get(data.pointer)?.down || type === Node.EventType.TOUCH_END) nodeTouches.delete(data.pointer);
    }
}

function subscribe(world: World, events: EntityEventQueue, controls: UIControlPointersData): void {
    const state = stateOf(world);
    if (state.subscribed.has(events)) return;
    state.subscribed.add(events);
    for (const type of Object.keys(TO_COCOS)) events.on(type, (e) => onPointerEvent(world, controls, e));
}

/** The global `input` hears every pointer, whether or not a node is under it. */
function pumpGlobalTouches(world: World, input: InputState, controls: UIControlPointersData): void {
    const { globalTouches } = stateOf(world);
    for (const p of uiPointersOf(input)) {
        const c = controls.pointers.get(p.id);
        if (!c) continue;
        let touch = globalTouches.get(p.id);
        const live = (): Touch[] => [...globalTouches.values()];
        if (p.pressed && !touch) {
            touch = new Touch(p.id, c.worldX, c.worldY, c.screenX, c.screenY);
            globalTouches.set(p.id, touch);
            globalInput.emit(Node.EventType.TOUCH_START, new EventTouch(Node.EventType.TOUCH_START, touch, live()));
        }
        if (!touch) continue;
        if (p.down && (c.worldX !== touch.getUILocationX() || c.worldY !== touch.getUILocationY())) {
            touch._move(c.worldX, c.worldY, c.screenX, c.screenY);
            globalInput.emit(Node.EventType.TOUCH_MOVE, new EventTouch(Node.EventType.TOUCH_MOVE, touch, live()));
        }
        if (p.released) {
            touch._move(c.worldX, c.worldY, c.screenX, c.screenY);
            const type = p.cancelled ? Node.EventType.TOUCH_CANCEL : Node.EventType.TOUCH_END;
            globalInput.emit(type, new EventTouch(type, touch, live()));
            globalTouches.delete(p.id);
        }
    }
}

// ---------------------------------------------------------------------------------------------------------------------
// Keyboard and mouse, to the global `input`.
// ---------------------------------------------------------------------------------------------------------------------

/** Where each input state's mouse was last frame, so a move is a change and the first frame is not one. */
const lastMouseOf = new WeakMap<InputState, { x: number; y: number }>();

/**
 * Turn this frame's key, button and wheel state into events on the global `input`. @p mouse is the engine's resolved mouse pointer
 * (null when there is none, as on a touch device), which is where the position comes from.
 */
export function pumpKeysAndMouse(input: InputState, mouse: ControlPointer | null): void {
    for (const code of input.keysPressed) globalInput.emit(InputApi.EventType.KEY_DOWN, new EventKeyboard(keyCodeOf(code), InputApi.EventType.KEY_DOWN));
    for (const code of input.keysDown) {
        if (!input.keysPressed.has(code)) globalInput.emit(InputApi.EventType.KEY_PRESSING, new EventKeyboard(keyCodeOf(code), InputApi.EventType.KEY_PRESSING));
    }
    for (const code of input.keysReleased) globalInput.emit(InputApi.EventType.KEY_UP, new EventKeyboard(keyCodeOf(code), InputApi.EventType.KEY_UP));

    const at = mouse ? { x: mouse.worldX, y: mouse.worldY, sx: mouse.screenX, sy: mouse.screenY } : { x: 0, y: 0, sx: 0, sy: 0 };
    const lastMouse = lastMouseOf.get(input);
    const previous = lastMouse ?? at;
    const moved = lastMouse !== undefined && (at.x !== lastMouse.x || at.y !== lastMouse.y);
    const prev = new Vec2(previous.x, previous.y);
    const event = (type: string): EventMouse => new EventMouse(type, at.x, at.y, prev, at.sx, at.sy);
    for (const b of input.mouseButtonsPressed) globalInput.emit(InputApi.EventType.MOUSE_DOWN, event(InputApi.EventType.MOUSE_DOWN)._button(b));
    if (moved) globalInput.emit(InputApi.EventType.MOUSE_MOVE, event(InputApi.EventType.MOUSE_MOVE));
    for (const b of input.mouseButtonsReleased) globalInput.emit(InputApi.EventType.MOUSE_UP, event(InputApi.EventType.MOUSE_UP)._button(b));
    if (input.scrollDeltaX !== 0 || input.scrollDeltaY !== 0) {
        // Cocos reports a wheel turned away from the player as positive; a DOM delta is the other way.
        globalInput.emit(InputApi.EventType.MOUSE_WHEEL, event(InputApi.EventType.MOUSE_WHEEL)._scroll(-input.scrollDeltaX, -input.scrollDeltaY));
    }
    lastMouseOf.set(input, { x: at.x, y: at.y });
}

/**
 * Register the systems that wire Cocos touches to the engine's pointer: one before the engine's UI interaction pass that makes
 * listening nodes interactable and subscribes to its events, one after it that feeds the global `input`.
 */
export function declareInputSystem(): void {
    addSystemToSchedule(Schedule.PreUpdate, defineSystem(
        [Res(EntityEvents), Res(UIControlPointers), GetWorld()],
        (events, controls, world) => {
            syncInteractables(world);
            // subscribed before the interaction pass, so the very first press already reaches a node
            if (events) subscribe(world, events as EntityEventQueue, controls);
        },
        { name: 'Cocos:Interactables', touches: { opaque: true }, runBefore: [SystemLabel.UIInteraction] },
    ));
    addSystemToSchedule(Schedule.PreUpdate, defineSystem(
        [Res(Input), Res(EntityEvents), Res(UIControlPointers), GetWorld()],
        (input, events, controls, world) => {
            if (!events) return;   // no UI pipeline: nothing resolves a pointer
            pumpGlobalTouches(world, input, controls);
            pumpKeysAndMouse(input, controls.pointers.get(MOUSE_POINTER) ?? null);
        },
        { name: 'Cocos:Input', touches: { opaque: true }, runAfter: [SystemLabel.UIInteraction] },
    ));
}
