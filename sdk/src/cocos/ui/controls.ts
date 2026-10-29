// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    cocos/ui/controls.ts
 * @brief   `Toggle`, `ToggleContainer`, `ProgressBar`, `Slider` and `BlockInputEvents`.
 *
 * The engine has its own toggles and sliders, but they are built on its flex-laid-out UI nodes; an imported scene is world-space
 * nodes with a rectangle each, so these are the Cocos components as small script classes over that, with Cocos's rules:
 * a toggle flips on a click that ends inside it, a group keeps one checked unless it allows none, a bar's fill is its length
 * times its progress, a slider reads progress from where the finger is along its rectangle.
 *
 * Like `Button`, they are declared script classes with stored settings, so a scene that holds one loads it.
 */
import { Component } from '../component';
import { Node } from '../node';
import { Vec3 } from '../math';
import { declareClass } from '../host';
import { Button, BUTTON_PROPS, EventHandler, joinHandlers } from './button';
import { Sprite } from './sprite';
import { UITransform } from './uiTransform';
import type { EventTouch } from '../input';

type Handlers = { component: string; handler: string; customEventData: string }[];

// ---------------------------------------------------------------------------------------------------------------------
// ToggleContainer / Toggle
// ---------------------------------------------------------------------------------------------------------------------

export class ToggleContainer extends Component {
    allowSwitchOff = false;
    checkTargets: Array<Node | null> = [];
    checkHandlers: Handlers = [];
    checkEvents: EventHandler[] = [];

    onLoad(): void {
        if (this.checkEvents.length === 0) this.checkEvents = joinHandlers(this.checkTargets, this.checkHandlers);
    }

    onEnable(): void { this.ensureValidState(); }

    /** The toggles under this container that are switched on. */
    get toggleItems(): Toggle[] {
        const out: Toggle[] = [];
        for (const child of this.node.children) {
            const t = child.getComponent(Toggle);
            if (t && t.enabled && child.active) out.push(t);
        }
        return out;
    }

    /** At least one on unless switching off is allowed, and never more than one. */
    ensureValidState(): void {
        const items = this.toggleItems;
        const checked = items.filter((t) => t.isChecked);
        if (!this.allowSwitchOff && checked.length === 0 && items.length > 0) items[0]!.isChecked = true;
        else if (checked.length > 1) for (const t of checked.slice(1)) t.isChecked = false;
    }

    anyTogglesChecked(): boolean { return this.toggleItems.some((t) => t.isChecked); }
    setAllTogglesOff(): void { for (const t of this.toggleItems) t.isChecked = false; }

    /** @internal A toggle in the group switched on: the others go off. */
    notifyToggleCheck(toggle: Toggle, emit = true): void {
        for (const t of this.toggleItems) if (t !== toggle && t.isChecked) t.setChecked_(false, emit);
        if (emit) {
            EventHandler.emitEvents(this.checkEvents, toggle);
            this.node.emit('toggle', this);
        }
    }
}

export class Toggle extends Button {
    static readonly EventType = Object.freeze({ TOGGLE: 'toggle', CLICK: 'click' });

    isChecked = false;
    /** The graphic shown while checked. */
    checkMark: Sprite | null = null;
    toggleGroup: ToggleContainer | null = null;
    checkTargets: Array<Node | null> = [];
    checkHandlers: Handlers = [];
    checkEvents: EventHandler[] = [];

    onLoad(): void {
        super.onLoad();
        if (this.checkEvents.length === 0) this.checkEvents = joinHandlers(this.checkTargets, this.checkHandlers);
    }

    onEnable(): void {
        super.onEnable();
        this.updateMark_();
    }

    /** Check it, as a script's `toggle.check()`: events fire, and its group's others go off. */
    check(): void { this.setChecked_(true, true); }
    uncheck(): void { this.setChecked_(false, true); }
    /** Set without any event. */
    setIsCheckedWithoutNotify(value: boolean): void { this.isChecked = value; this.updateMark_(); }

    protected onClicked_(_event: EventTouch): void {
        if (!this.interactable) return;
        const group = this.toggleGroup;
        // in a group that needs one on, clicking the one that is on does nothing
        if (group && group.enabled && this.isChecked && !group.allowSwitchOff) return;
        this.setChecked_(!this.isChecked, true);
    }

    /** @internal */
    setChecked_(value: boolean, emit: boolean): void {
        if (this.isChecked === value) return;
        this.isChecked = value;
        this.updateMark_();
        if (value && this.toggleGroup && this.toggleGroup.enabled) this.toggleGroup.notifyToggleCheck(this, emit);
        if (emit) {
            EventHandler.emitEvents(this.checkEvents, this);
            this.node.emit(Toggle.EventType.TOGGLE, this);
        }
    }

    private updateMark_(): void {
        if (this.checkMark) this.checkMark.node.active = this.isChecked;
    }
}

// ---------------------------------------------------------------------------------------------------------------------
// ProgressBar
// ---------------------------------------------------------------------------------------------------------------------

const BarMode = Object.freeze({ HORIZONTAL: 0, VERTICAL: 1, FILLED: 2 });

export class ProgressBar extends Component {
    static readonly Mode = BarMode;

    mode: number = BarMode.HORIZONTAL;
    totalLength = 100;
    progress_ = 0.5;
    reverse = false;
    barSprite: Sprite | null = null;

    get progress(): number { return this.progress_; }
    set progress(v: number) {
        this.progress_ = Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));
        this.update_();
    }

    onEnable(): void { this.update_(); }

    private update_(): void {
        const bar = this.barSprite;
        if (!bar) return;
        const length = this.totalLength * this.progress_;
        if (this.mode === BarMode.FILLED) {
            bar.fillRange = this.reverse ? -this.progress_ : this.progress_;
            return;
        }
        const t = bar.node.getComponent(UITransform);
        if (!t) return;
        if (this.mode === BarMode.HORIZONTAL) t.width = length; else t.height = length;
    }
}

// ---------------------------------------------------------------------------------------------------------------------
// Slider
// ---------------------------------------------------------------------------------------------------------------------

const SliderDirection = Object.freeze({ HORIZONTAL: 0, VERTICAL: 1 });

export class Slider extends Component {
    static readonly Direction = SliderDirection;
    static readonly EventType = Object.freeze({ SLIDE: 'slide' });

    direction: number = SliderDirection.HORIZONTAL;
    progress_ = 0.5;
    handle: Button | null = null;
    slideTargets: Array<Node | null> = [];
    slideHandlers: Handlers = [];
    slideEvents: EventHandler[] = [];

    get progress(): number { return this.progress_; }
    set progress(v: number) {
        const next = Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));
        if (next === this.progress_) return;
        this.progress_ = next;
        this.placeHandle_();
        EventHandler.emitEvents(this.slideEvents, this);
        this.node.emit(Slider.EventType.SLIDE, this);
    }

    onLoad(): void {
        if (this.slideEvents.length === 0) this.slideEvents = joinHandlers(this.slideTargets, this.slideHandlers);
    }

    onEnable(): void {
        this.node.on(Node.EventType.TOUCH_START, this.onTouch_, this);
        this.node.on(Node.EventType.TOUCH_MOVE, this.onTouch_, this);
        const handle = this.handle?.node;
        if (handle) {
            handle.on(Node.EventType.TOUCH_START, this.onHandleTouch_, this);
            handle.on(Node.EventType.TOUCH_MOVE, this.onHandleTouch_, this);
        }
        this.placeHandle_();
    }

    onDisable(): void {
        this.node.off(Node.EventType.TOUCH_START, this.onTouch_, this);
        this.node.off(Node.EventType.TOUCH_MOVE, this.onTouch_, this);
        const handle = this.handle?.node;
        if (handle) {
            handle.off(Node.EventType.TOUCH_START, this.onHandleTouch_, this);
            handle.off(Node.EventType.TOUCH_MOVE, this.onHandleTouch_, this);
        }
    }

    private onTouch_(event: EventTouch): void {
        if (this.handle && !this.handle.interactable) return;
        this.slideTo_(event);
        event.stopPropagation();
    }

    private onHandleTouch_(event: EventTouch): void {
        this.slideTo_(event);
        event.stopPropagation();
    }

    /** Progress from where the finger is along the slider's rectangle. */
    private slideTo_(event: EventTouch): void {
        const t = this.node.getComponent(UITransform);
        if (!t) return;
        const loc = event.getUILocation();
        const local = t.convertToNodeSpaceAR(new Vec3(loc.x, loc.y, 0));
        this.progress = this.direction === SliderDirection.HORIZONTAL
            ? (local.x + t.anchorX * t.width) / (t.width || 1)
            : (local.y + t.anchorY * t.height) / (t.height || 1);
    }

    private placeHandle_(): void {
        const handle = this.handle?.node;
        const t = this.node.getComponent(UITransform);
        if (!handle || !t) return;
        const p = handle.getPosition();
        if (this.direction === SliderDirection.HORIZONTAL) handle.setPosition(new Vec3(this.progress_ * t.width - t.anchorX * t.width, p.y, p.z));
        else handle.setPosition(new Vec3(p.x, this.progress_ * t.height - t.anchorY * t.height, p.z));
    }
}

// ---------------------------------------------------------------------------------------------------------------------
// BlockInputEvents
// ---------------------------------------------------------------------------------------------------------------------

/** A node that takes every touch that lands on it, so nothing behind it hears it. */
export class BlockInputEvents extends Component {
    private readonly stop_ = (event: { stopPropagation(): void }): void => { event.stopPropagation(); };
    private static readonly TYPES = [Node.EventType.TOUCH_START, Node.EventType.TOUCH_MOVE, Node.EventType.TOUCH_END, Node.EventType.TOUCH_CANCEL];

    onEnable(): void { for (const t of BlockInputEvents.TYPES) this.node.on(t, this.stop_, this); }
    onDisable(): void { for (const t of BlockInputEvents.TYPES) this.node.off(t, this.stop_, this); }
}

// ---------------------------------------------------------------------------------------------------------------------

export function declareControls(): void {
    declareClass(ToggleContainer as never, 'ToggleContainer', [
        { name: 'allowSwitchOff', kind: 'boolean' },
        { name: 'checkTargets', kind: 'node', array: true },
        { name: 'checkHandlers', kind: 'json' },
    ]);
    declareClass(Toggle as never, 'Toggle', [
        ...BUTTON_PROPS,
        { name: 'isChecked', kind: 'boolean' },
        { name: 'checkMark', kind: 'component', type: Sprite },
        { name: 'toggleGroup', kind: 'component', type: ToggleContainer },
        { name: 'checkTargets', kind: 'node', array: true },
        { name: 'checkHandlers', kind: 'json' },
    ]);
    declareClass(ProgressBar as never, 'ProgressBar', [
        { name: 'mode', kind: 'number' },
        { name: 'totalLength', kind: 'number' },
        { name: 'progress_', kind: 'number' },
        { name: 'reverse', kind: 'boolean' },
        { name: 'barSprite', kind: 'component', type: Sprite },
    ]);
    declareClass(Slider as never, 'Slider', [
        { name: 'direction', kind: 'number' },
        { name: 'progress_', kind: 'number' },
        { name: 'handle', kind: 'component', type: Button },
        { name: 'slideTargets', kind: 'node', array: true },
        { name: 'slideHandlers', kind: 'json' },
    ]);
    declareClass(BlockInputEvents as never, 'BlockInputEvents', []);
}
