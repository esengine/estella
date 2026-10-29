// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    cocos/ui/scrollView.ts
 * @brief   `ScrollView`: a content node moved inside a view by dragging, with inertia and an elastic edge.
 *
 * The motion is the engine's own scroll model (ui/collection: ScrollContainer, KineticScroll, ScrollMotion) — the same one the
 * engine's UI scroll areas use — and this adds Cocos's shape around it: the view is the content's parent, the content is a child
 * that is bigger, and the offsets scripts read are Cocos's (`getScrollOffset()` is how far the content has moved toward its end;
 * positive x is scrolled right, positive y scrolled down). The settings map onto the model: `elastic` and `bounceDuration` are the
 * container's, `inertia` and `brake` set how long a flick coasts.
 *
 * Touches are heard in the CAPTURE phase, so a drag that starts on a button inside the content still scrolls; once the finger has
 * moved far enough to be a drag, the button is cancelled (`cancelInnerEvents`) and does not click on release.
 */
import { Component } from '../component';
import { Node } from '../node';
import { Vec2, Vec3 } from '../math';
import { declareClass } from '../host';
import { ScrollContainer } from '../../ui/collection/scroll-container';
import { ScrollMotion } from '../../ui/collection/scroll-motion';
import { KineticScroll } from '../../ui/collection/kinetic-scroll';
import { EventHandler, joinHandlers } from './button';
import { UITransform } from './uiTransform';
import type { EventTouch } from '../input';

const EventType = Object.freeze({
    SCROLL_TO_TOP: 'scroll-to-top',
    SCROLL_TO_BOTTOM: 'scroll-to-bottom',
    SCROLL_TO_LEFT: 'scroll-to-left',
    SCROLL_TO_RIGHT: 'scroll-to-right',
    SCROLLING: 'scrolling',
    BOUNCE_TOP: 'bounce-top',
    BOUNCE_BOTTOM: 'bounce-bottom',
    BOUNCE_LEFT: 'bounce-left',
    BOUNCE_RIGHT: 'bounce-right',
    SCROLL_ENDED: 'scroll-ended',
    TOUCH_UP: 'touch-up',
    AUTOSCROLL_ENDED_WITH_THRESHOLD: 'autoscroll-ended-with-threshold',
    SCROLL_BEGAN: 'scroll-began',
});

/** How far a finger must travel before the touch is a drag and the node under it is cancelled. */
const DRAG_THRESHOLD = 7;

/** Cocos's `brake` (0 = coast long, 1 = stop at once) as the fraction of speed the engine's coast keeps after a second. */
const decelerationOf = (brake: number): number => 0.5 * 0.04 ** Math.min(1, Math.max(0, brake));

export class ScrollView extends Component {
    static readonly EventType = EventType;

    content: Node | null = null;
    horizontal = false;
    vertical = true;
    inertia = true;
    brake = 0.5;
    elastic = true;
    bounceDuration = 1;
    cancelInnerEvents = true;
    scrollTargets: Array<Node | null> = [];
    scrollHandlers: { component: string; handler: string; customEventData: string }[] = [];
    scrollEvents: EventHandler[] = [];

    private motion_: ScrollMotion | null = null;
    private settings_ = '';
    private dragging_ = false;
    private began_ = false;
    private travelled_ = 0;
    private anchor_: Vec3 | null = null;
    private last_: Vec3 | null = null;
    private resting_ = true;
    private edge_ = { top: false, bottom: false, left: false, right: false };

    onLoad(): void {
        if (this.scrollEvents.length === 0) this.scrollEvents = joinHandlers(this.scrollTargets, this.scrollHandlers);
    }

    onEnable(): void {
        this.node.on(Node.EventType.TOUCH_START, this.onStart_, this, true);
        this.node.on(Node.EventType.TOUCH_MOVE, this.onMove_, this, true);
        this.node.on(Node.EventType.TOUCH_END, this.onEnd_, this, true);
        this.node.on(Node.EventType.TOUCH_CANCEL, this.onCancel_, this, true);
        // listening in capture alone leaves the node itself unclaimed when nothing under the finger listens
        this.node.on(Node.EventType.TOUCH_START, noop, this);
        this.sync_();
        this.place_();
    }

    onDisable(): void {
        this.node.off(Node.EventType.TOUCH_START, this.onStart_, this, true);
        this.node.off(Node.EventType.TOUCH_MOVE, this.onMove_, this, true);
        this.node.off(Node.EventType.TOUCH_END, this.onEnd_, this, true);
        this.node.off(Node.EventType.TOUCH_CANCEL, this.onCancel_, this, true);
        this.node.off(Node.EventType.TOUCH_START, noop, this);
        this.dragging_ = false;
    }

    update(dt: number): void {
        if (this.dragging_) return;
        const motion = this.sync_();
        if (!motion) return;
        if (motion.tick(dt)) { this.place_(); this.notify_(EventType.SCROLLING); }
        const idle = !motion.isMoving;
        if (idle && !this.resting_) {
            this.resting_ = true;
            this.notify_(EventType.SCROLL_ENDED);
        } else if (!idle) {
            this.resting_ = false;
        }
    }

    // ---- the Cocos API ------------------------------------------------------------------------------------------------

    /** How far the content has moved toward its end on each axis (right and down are positive). */
    getScrollOffset(): Vec2 { const o = this.sync_()?.container.getOffset(); return new Vec2(o?.x ?? 0, o?.y ?? 0); }
    getMaxScrollOffset(): Vec2 { const m = this.sync_()?.container.getMaxOffset(); return new Vec2(m?.x ?? 0, m?.y ?? 0); }
    isScrolling(): boolean { return this.dragging_ || (this.motion_?.isMoving ?? false); }
    isAutoScrolling(): boolean { return !this.dragging_ && (this.motion_?.isMoving ?? false); }
    stopAutoScroll(): void { this.motion_?.stop(); }

    scrollToOffset(offset: Vec2, timeInSecond = 0, _attenuated = true): void {
        const motion = this.sync_();
        if (!motion) return;
        const o = motion.container.getOffset();
        motion.animateTo({ x: this.horizontal ? offset.x : o.x, y: this.vertical ? offset.y : o.y }, timeInSecond);
        if (timeInSecond <= 0) { this.place_(); this.notify_(EventType.SCROLLING); }
    }

    /** Scroll so the content's position along each axis is @p anchor, 0..1, where (0, 1) is the top-left. */
    scrollTo(anchor: Vec2, timeInSecond = 0, attenuated = true): void {
        const max = this.getMaxScrollOffset();
        this.scrollToOffset(new Vec2(anchor.x * max.x, (1 - anchor.y) * max.y), timeInSecond, attenuated);
    }
    scrollToTop(t = 0, a = true): void { this.scrollToOffset(new Vec2(this.getScrollOffset().x, 0), t, a); }
    scrollToBottom(t = 0, a = true): void { this.scrollToOffset(new Vec2(this.getScrollOffset().x, this.getMaxScrollOffset().y), t, a); }
    scrollToLeft(t = 0, a = true): void { this.scrollToOffset(new Vec2(0, this.getScrollOffset().y), t, a); }
    scrollToRight(t = 0, a = true): void { this.scrollToOffset(new Vec2(this.getMaxScrollOffset().x, this.getScrollOffset().y), t, a); }
    scrollToTopLeft(t = 0, a = true): void { this.scrollToOffset(new Vec2(0, 0), t, a); }
    scrollToTopRight(t = 0, a = true): void { this.scrollToOffset(new Vec2(this.getMaxScrollOffset().x, 0), t, a); }
    scrollToBottomLeft(t = 0, a = true): void { this.scrollToOffset(new Vec2(0, this.getMaxScrollOffset().y), t, a); }
    scrollToBottomRight(t = 0, a = true): void { const m = this.getMaxScrollOffset(); this.scrollToOffset(new Vec2(m.x, m.y), t, a); }

    getContentPosition(): Vec3 { return this.content?.getPosition() ?? new Vec3(); }
    setContentPosition(p: Vec3): void { this.content?.setPosition(p); this.readBack_(); }

    // ---- geometry ------------------------------------------------------------------------------------------------------

    private view_(): UITransform | null { return this.content?.parent?.getComponent(UITransform) ?? null; }
    private contentSize_(): { w: number; h: number; ax: number; ay: number } | null {
        const c = this.content;
        const t = c?.getComponent(UITransform);
        if (!c || !t) return null;
        const s = c.getScale();
        return { w: t.width * Math.abs(s.x), h: t.height * Math.abs(s.y), ax: t.anchorX, ay: t.anchorY };
    }

    /** The engine's scroll model for this view, made when the settings are first known and again when they change; its extents kept current. */
    private sync_(): ScrollMotion | null {
        const view = this.view_();
        const c = this.contentSize_();
        if (!view || !c) return this.motion_;
        const key = [this.horizontal, this.vertical, this.inertia, this.brake, this.elastic, this.bounceDuration].join(',');
        if (!this.motion_ || key !== this.settings_) {
            const previous = this.motion_?.container.getOffset();
            const container = new ScrollContainer({
                viewportSize: { x: view.width, y: view.height },
                contentSize: { x: c.w, y: c.h },
                direction: this.horizontal && this.vertical ? 'both' : this.horizontal ? 'horizontal' : 'vertical',
                elastic: this.elastic,
                bounceTime: this.bounceDuration,
                initialOffset: previous,
                showScrollbar: false,
            });
            // no inertia is a coast that stops at once
            this.motion_ = new ScrollMotion(container, new KineticScroll({ decelerationRate: this.inertia ? decelerationOf(this.brake) : 0 }));
            this.settings_ = key;
            this.readBack_();
        }
        this.motion_.container.setSizes({ x: view.width, y: view.height }, { x: c.w, y: c.h });
        return this.motion_;
    }

    /** Put the content where the model says, pulled past an end by the overscroll. */
    private place_(): void {
        const view = this.view_();
        const c = this.contentSize_();
        const content = this.content;
        const container = this.motion_?.container;
        if (!view || !c || !content || !container) return;
        const o = container.getOffset();
        const over = container.getOverscroll();
        const p = content.getPosition();
        const viewLeft = -view.anchorX * view.width;
        const viewTop = (1 - view.anchorY) * view.height;
        // when the content is narrower than the view it sits at the start edge, as Cocos's does
        const x = this.horizontal ? viewLeft - (o.x + over.x) + c.ax * c.w : p.x;
        const y = this.vertical ? viewTop + (o.y + over.y) - (1 - c.ay) * c.h : p.y;
        content.setPosition(new Vec3(x, y, p.z));
    }

    /** Take the offsets from where the content is now (a script may have moved it). */
    private readBack_(): void {
        const view = this.view_();
        const c = this.contentSize_();
        const content = this.content;
        const container = this.motion_?.container;
        if (!view || !c || !content || !container) return;
        const p = content.getPosition();
        container.setOffset({
            x: -view.anchorX * view.width - (p.x - c.ax * c.w),
            y: p.y + (1 - c.ay) * c.h - (1 - view.anchorY) * view.height,
        });
    }

    // ---- touches -------------------------------------------------------------------------------------------------------

    private local_(event: EventTouch): Vec3 | null {
        const view = this.view_();
        if (!view) return null;
        const loc = event.getUILocation();
        return view.convertToNodeSpaceAR(new Vec3(loc.x, loc.y, 0));
    }

    private onStart_(event: EventTouch): void {
        const motion = this.sync_();
        if (!this.content || !motion) return;
        this.readBack_();
        motion.grab();
        this.dragging_ = true;
        this.began_ = false;
        this.travelled_ = 0;
        this.anchor_ = null;
        this.last_ = this.local_(event);
    }

    private onMove_(event: EventTouch): void {
        const motion = this.motion_;
        if (!this.dragging_ || !this.last_ || !motion) return;
        const now = this.local_(event);
        if (!now) return;
        this.travelled_ += Math.hypot(now.x - this.last_.x, now.y - this.last_.y);
        this.last_ = now;
        if (this.travelled_ < DRAG_THRESHOLD && !this.began_) return;
        if (!this.began_) {
            this.began_ = true;
            this.resting_ = false;
            // the drag counts from where it became one, so the content does not jump by the threshold
            this.anchor_ = now;
            if (this.cancelInnerEvents) event.cancelInner();
            this.notify_(EventType.SCROLL_BEGAN);
            return;
        }
        const a = this.anchor_!;
        motion.dragBy({ x: this.horizontal ? -(now.x - a.x) : 0, y: this.vertical ? now.y - a.y : 0 }, 1 / 60);
        this.place_();
        this.notify_(EventType.SCROLLING);
        // a drag the scroll view owns is not the business of anything above it
        event.stopPropagation();
    }

    private onEnd_(event: EventTouch): void {
        if (!this.dragging_) return;
        this.dragging_ = false;
        this.notify_(EventType.TOUCH_UP);
        if (this.began_) {
            this.motion_?.release();
            event.stopPropagation();
        }
        this.began_ = false;
    }

    private onCancel_(): void {
        // a cancel the scroll view itself caused must not end its own drag; one from above does
        if (this.began_) return;
        this.dragging_ = false;
    }

    // ---- events --------------------------------------------------------------------------------------------------------

    private notify_(type: string): void {
        EventHandler.emitEvents(this.scrollEvents, this, type);
        this.node.emit(type, this);
        if (type !== EventType.SCROLLING) return;
        const o = this.motion_?.container.getOffset() ?? { x: 0, y: 0 };
        const m = this.motion_?.container.getMaxOffset() ?? { x: 0, y: 0 };
        const e = this.edge_;
        const atTop = o.y <= 0, atBottom = o.y >= m.y && m.y > 0;
        const atLeft = o.x <= 0, atRight = o.x >= m.x && m.x > 0;
        if (atTop && !e.top) this.notifyEdge_(EventType.SCROLL_TO_TOP);
        if (atBottom && !e.bottom) this.notifyEdge_(EventType.SCROLL_TO_BOTTOM);
        if (atLeft && !e.left) this.notifyEdge_(EventType.SCROLL_TO_LEFT);
        if (atRight && !e.right) this.notifyEdge_(EventType.SCROLL_TO_RIGHT);
        e.top = atTop; e.bottom = atBottom; e.left = atLeft; e.right = atRight;
    }

    private notifyEdge_(type: string): void {
        EventHandler.emitEvents(this.scrollEvents, this, type);
        this.node.emit(type, this);
    }
}

function noop(): void { /* claims the node for touches; the capture handlers do the work */ }

export function declareScrollView(): void {
    declareClass(ScrollView as never, 'ScrollView', [
        { name: 'content', kind: 'node' },
        { name: 'horizontal', kind: 'boolean' },
        { name: 'vertical', kind: 'boolean' },
        { name: 'inertia', kind: 'boolean' },
        { name: 'brake', kind: 'number' },
        { name: 'elastic', kind: 'boolean' },
        { name: 'bounceDuration', kind: 'number' },
        { name: 'cancelInnerEvents', kind: 'boolean' },
        { name: 'scrollTargets', kind: 'node', array: true },
        { name: 'scrollHandlers', kind: 'json' },
    ]);
}
