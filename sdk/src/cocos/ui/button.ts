// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    cocos/ui/button.ts
 * @brief   `Button` and `EventHandler`.
 *
 * Unlike `Label` or `Sprite`, a button is behaviour: it listens for the touches on its node and, when one ends inside, says "click"
 * — to the handlers authored in the editor (`clickEvents`) and to whoever did `node.on(Button.EventType.CLICK, ...)`. So it is a
 * real script class, declared through the same path as a game's (host.ts), with its settings as stored data.
 *
 * The one thing an editor-authored handler holds that the engine's data model cannot carry is a node reference inside a list of
 * records. The records are therefore stored as two parallel lists — the targets, which are entity references the scene loader
 * remaps, and the rest of each handler — and joined here when the button loads.
 */
import { Component } from '../component';
import { Color } from '../math';
import { Node } from '../node';
import { declareClass } from '../host';
import { classInfoNamed } from '../registry';
import { Sprite } from './sprite';
import { UITransform } from './uiTransform';
import type { EventTouch } from '../input';

/** An editor-authored callback: call `handler` on the `component` of `target`, with the event and `customEventData`. */
export class EventHandler {
    target: Node | null = null;
    /** The class name of the component on `target`. */
    component = '';
    handler = '';
    customEventData = '';

    emit(args: unknown[] = []): void {
        const target = this.target;
        if (!target || !target.isValid || !this.handler) return;
        const comp = this.component ? target.getComponent(this.component) : null;
        const fn = (comp as unknown as Record<string, unknown> | null)?.[this.handler];
        if (typeof fn === 'function') fn.apply(comp, [...args, this.customEventData]);
    }

    static emitEvents(handlers: EventHandler[], ...args: unknown[]): void {
        for (const h of handlers) h.emit(args);
    }
}

/** Editor-authored handlers are stored as a list of target nodes beside a list of the rest; join them. */
export function joinHandlers(
    targets: Array<Node | null>,
    records: Array<{ component: string; handler: string; customEventData: string }>,
): EventHandler[] {
    return records.map((r, i) => {
        const e = new EventHandler();
        e.target = targets[i] ?? null;
        e.component = r.component;
        e.handler = r.handler;
        e.customEventData = r.customEventData;
        return e;
    });
}

const Transition = Object.freeze({ NONE: 0, COLOR: 1, SPRITE: 2, SCALE: 3 });
const EventType = Object.freeze({ CLICK: 'click' });

export class Button extends Component {
    static readonly Transition = Transition;
    static readonly EventType = EventType;

    interactable = true;
    transition: number = Transition.NONE;
    zoomScale = 1.2;
    duration = 0.1;
    normalColor = new Color(255, 255, 255, 255);
    hoverColor = new Color(211, 211, 211, 255);
    pressedColor = new Color(255, 255, 255, 255);
    disabledColor = new Color(124, 124, 124, 255);
    /** The node the transition acts on; this node when none is set. */
    target: Node | null = null;
    clickTargets: Array<Node | null> = [];
    clickHandlers: Array<{ component: string; handler: string; customEventData: string }> = [];
    clickEvents: EventHandler[] = [];

    private pressed_ = false;
    private restScale_: { x: number; y: number; z: number } | null = null;

    onLoad(): void {
        if (this.clickEvents.length === 0) this.clickEvents = joinHandlers(this.clickTargets, this.clickHandlers);
    }

    onEnable(): void {
        this.node.on(Node.EventType.TOUCH_START, this.onTouchStart, this);
        this.node.on(Node.EventType.TOUCH_END, this.onTouchEnd, this);
        this.node.on(Node.EventType.TOUCH_CANCEL, this.onTouchCancel, this);
        this.applyTransition_();
    }

    onDisable(): void {
        this.node.off(Node.EventType.TOUCH_START, this.onTouchStart, this);
        this.node.off(Node.EventType.TOUCH_END, this.onTouchEnd, this);
        this.node.off(Node.EventType.TOUCH_CANCEL, this.onTouchCancel, this);
        this.pressed_ = false;
        this.restore_();
    }

    private onTouchStart(event: EventTouch): void {
        if (!this.interactable || !this.enabledInHierarchy) return;
        this.pressed_ = true;
        this.applyTransition_();
        event.stopPropagation();
    }

    private onTouchEnd(event: EventTouch): void {
        if (!this.pressed_) return;
        this.pressed_ = false;
        this.applyTransition_();
        const inside = this.node.getComponent(UITransform)?.isHit(event.getUILocation()) ?? true;
        if (this.interactable && this.enabledInHierarchy && inside) {
            EventHandler.emitEvents(this.clickEvents, event);
            this.node.emit(EventType.CLICK, this);
            this.onClicked_(event);
        }
        event.stopPropagation();
    }

    /** A click has been delivered. A button has nothing more to do; a toggle flips here. */
    protected onClicked_(_event: EventTouch): void { /* nothing */ }

    private onTouchCancel(): void {
        this.pressed_ = false;
        this.applyTransition_();
    }

    /** The node the transition acts on. */
    private transitionTarget_(): Node { return this.target ?? this.node; }

    private restore_(): void {
        if (this.restScale_) {
            const s = this.restScale_;
            this.transitionTarget_().setScale(s.x, s.y, s.z);
            this.restScale_ = null;
        }
    }

    /** Instant: the press is shown or not. Cocos eases these over `duration`; a transition that lasts a tenth of a second is not what a script reads. */
    private applyTransition_(): void {
        const node = this.transitionTarget_();
        if (this.transition === Transition.SCALE) {
            if (this.pressed_) {
                if (!this.restScale_) { const s = node.scale; this.restScale_ = { x: s.x, y: s.y, z: s.z }; }
                const r = this.restScale_;
                node.setScale(r.x * this.zoomScale, r.y * this.zoomScale, r.z);
            } else {
                this.restore_();
            }
        } else if (this.transition === Transition.COLOR) {
            const sprite = node.getComponent(Sprite);
            if (sprite) sprite.color = !this.interactable ? this.disabledColor : this.pressed_ ? this.pressedColor : this.normalColor;
        }
    }
}

/** Declare the button's component, so a scene that holds one finds it. */
export const BUTTON_PROPS: Array<{ name: string; kind: 'number' | 'boolean' | 'color' | 'node' | 'json'; array?: boolean }> = [
    { name: 'interactable', kind: 'boolean' },
    { name: 'transition', kind: 'number' },
    { name: 'zoomScale', kind: 'number' },
    { name: 'duration', kind: 'number' },
    { name: 'normalColor', kind: 'color' },
    { name: 'hoverColor', kind: 'color' },
    { name: 'pressedColor', kind: 'color' },
    { name: 'disabledColor', kind: 'color' },
    { name: 'target', kind: 'node' },
    { name: 'clickTargets', kind: 'node', array: true },
    { name: 'clickHandlers', kind: 'json' },
];

export function declareButton(): void {
    declareClass(Button as never, 'Button', BUTTON_PROPS);
}

export const isButtonDeclared = (): boolean => classInfoNamed('Button') !== undefined;

declare module '../component' {
    namespace Component {
        /** `Component.EventHandler`, as scripts name the class. */
        let EventHandler: typeof import('./button').EventHandler;
    }
}
(Component as unknown as { EventHandler: typeof EventHandler }).EventHandler = EventHandler;
