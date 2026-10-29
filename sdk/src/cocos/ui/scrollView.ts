// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    cocos/ui/scrollView.ts
 * @brief   `ScrollView`: a content node moved inside a view by dragging, with inertia and an elastic edge.
 *
 * The motion is the engine's own scroll physics (ui/collection/scroll-physics.ts); what this adds is Cocos's shape around it. The
 * view is the content's parent, the content is a child that is bigger, and the offsets scripts read are Cocos's: `getScrollOffset()`
 * is how far the content has moved toward its end (positive x = scrolled right, positive y = scrolled down).
 *
 * Touches are heard in the CAPTURE phase, so a drag that starts on a button inside the content still scrolls; once the finger has
 * moved far enough to be a drag, the button is cancelled (`cancelInnerEvents`) and does not click on release.
 *
 * The glide and the spring have Cocos's character and not its digits: a flick goes on for a time that follows its speed and
 * eases out, a pull past the end is damped and returns. Scripts that depend on exact distances should not expect them.
 */
import { Component } from '../component';
import { Node } from '../node';
import { Vec2, Vec3 } from '../math';
import { declareClass } from '../host';
import { ScrollAxis } from '../../ui/collection/scroll-physics';
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

    private readonly x_ = new ScrollAxis();
    private readonly y_ = new ScrollAxis();
    private clock_ = 0;
    private dragging_ = false;
    private began_ = false;
    private travelled_ = 0;
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
        this.syncAxes_();
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
        this.clock_ += dt;
        if (!this.dragging_) {
            this.syncAxes_();
            const moved = this.x_.update(dt) || this.y_.update(dt);
            if (moved) { this.place_(); this.notify_(EventType.SCROLLING); }
            const idle = !this.x_.moving && !this.y_.moving;
            if (idle && !this.resting_) {
                this.resting_ = true;
                this.notify_(EventType.SCROLL_ENDED);
            } else if (!idle) {
                this.resting_ = false;
            }
        }
    }

    // ---- the Cocos API ------------------------------------------------------------------------------------------------

    /** How far the content has moved toward its end on each axis (right and down are positive). */
    getScrollOffset(): Vec2 { return new Vec2(this.x_.offset, this.y_.offset); }
    getMaxScrollOffset(): Vec2 { this.syncAxes_(); return new Vec2(this.x_.max, this.y_.max); }
    isScrolling(): boolean { return this.dragging_ || this.x_.moving || this.y_.moving; }
    isAutoScrolling(): boolean { return !this.dragging_ && (this.x_.moving || this.y_.moving); }
    stopAutoScroll(): void { this.x_.stop(); this.y_.stop(); }

    scrollToOffset(offset: Vec2, timeInSecond = 0, attenuated = true): void {
        this.syncAxes_();
        if (this.horizontal) this.x_.scrollTo(offset.x, timeInSecond, attenuated);
        if (this.vertical) this.y_.scrollTo(offset.y, timeInSecond, attenuated);
        if (timeInSecond <= 0) { this.place_(); this.notify_(EventType.SCROLLING); }
    }

    /** Scroll so the content's position along each axis is @p anchor, 0..1, where (0, 1) is the top-left. */
    scrollTo(anchor: Vec2, timeInSecond = 0, attenuated = true): void {
        this.syncAxes_();
        this.scrollToOffset(new Vec2(anchor.x * this.x_.max, (1 - anchor.y) * this.y_.max), timeInSecond, attenuated);
    }
    scrollToTop(t = 0, a = true): void { this.scrollToOffset(new Vec2(this.x_.offset, 0), t, a); }
    scrollToBottom(t = 0, a = true): void { this.syncAxes_(); this.scrollToOffset(new Vec2(this.x_.offset, this.y_.max), t, a); }
    scrollToLeft(t = 0, a = true): void { this.scrollToOffset(new Vec2(0, this.y_.offset), t, a); }
    scrollToRight(t = 0, a = true): void { this.syncAxes_(); this.scrollToOffset(new Vec2(this.x_.max, this.y_.offset), t, a); }
    scrollToTopLeft(t = 0, a = true): void { this.scrollToOffset(new Vec2(0, 0), t, a); }
    scrollToTopRight(t = 0, a = true): void { this.syncAxes_(); this.scrollToOffset(new Vec2(this.x_.max, 0), t, a); }
    scrollToBottomLeft(t = 0, a = true): void { this.syncAxes_(); this.scrollToOffset(new Vec2(0, this.y_.max), t, a); }
    scrollToBottomRight(t = 0, a = true): void { this.syncAxes_(); this.scrollToOffset(new Vec2(this.x_.max, this.y_.max), t, a); }

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

    private syncAxes_(): void {
        const view = this.view_();
        const c = this.contentSize_();
        if (!view || !c) return;
        for (const axis of [this.x_, this.y_]) {
            axis.settings.inertia = this.inertia;
            axis.settings.elastic = this.elastic;
            axis.settings.brake = this.brake;
            axis.settings.bounceTime = this.bounceDuration;
        }
        this.x_.setExtents(view.width, c.w);
        this.y_.setExtents(view.height, c.h);
    }

    /** Put the content where the axes say. */
    private place_(): void {
        const view = this.view_();
        const c = this.contentSize_();
        const content = this.content;
        if (!view || !c || !content) return;
        const p = content.getPosition();
        const viewLeft = -view.anchorX * view.width;
        const viewTop = (1 - view.anchorY) * view.height;
        // when the content is narrower than the view it sits at the start edge, as Cocos's does
        const x = this.horizontal ? viewLeft - this.x_.offset + c.ax * c.w : p.x;
        const y = this.vertical ? viewTop + this.y_.offset - (1 - c.ay) * c.h : p.y;
        content.setPosition(new Vec3(x, y, p.z));
    }

    /** Take the offsets from where the content is now. */
    private readBack_(): void {
        const view = this.view_();
        const c = this.contentSize_();
        const content = this.content;
        if (!view || !c || !content) return;
        const p = content.getPosition();
        this.x_.offset = -view.anchorX * view.width - (p.x - c.ax * c.w);
        this.y_.offset = p.y + (1 - c.ay) * c.h - (1 - view.anchorY) * view.height;
    }

    // ---- touches -------------------------------------------------------------------------------------------------------

    private local_(event: EventTouch): Vec3 | null {
        const view = this.view_();
        if (!view) return null;
        const loc = event.getUILocation();
        return view.convertToNodeSpaceAR(new Vec3(loc.x, loc.y, 0));
    }

    private onStart_(event: EventTouch): void {
        if (!this.content) return;
        this.syncAxes_();
        this.readBack_();
        this.x_.press();
        this.y_.press();
        this.dragging_ = true;
        this.began_ = false;
        this.travelled_ = 0;
        this.last_ = this.local_(event);
    }

    private onMove_(event: EventTouch): void {
        if (!this.dragging_ || !this.last_) return;
        const now = this.local_(event);
        if (!now) return;
        const dx = now.x - this.last_.x, dy = now.y - this.last_.y;
        this.last_ = now;
        this.travelled_ += Math.hypot(dx, dy);
        if (this.travelled_ < DRAG_THRESHOLD && !this.began_) return;
        if (!this.began_) {
            this.began_ = true;
            this.resting_ = false;
            if (this.cancelInnerEvents) event.cancelInner();
            this.notify_(EventType.SCROLL_BEGAN);
        }
        const view = this.view_()!;
        if (this.horizontal) this.x_.drag(-dx, this.clock_, view.width);
        if (this.vertical) this.y_.drag(dy, this.clock_, view.height);
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
            this.x_.release();
            this.y_.release();
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
        const e = this.edge_;
        const atTop = this.y_.offset <= 0, atBottom = this.y_.offset >= this.y_.max && this.y_.max > 0;
        const atLeft = this.x_.offset <= 0, atRight = this.x_.offset >= this.x_.max && this.x_.max > 0;
        if (atTop && !e.top) { this.notifyEdge_(EventType.SCROLL_TO_TOP); }
        if (atBottom && !e.bottom) { this.notifyEdge_(EventType.SCROLL_TO_BOTTOM); }
        if (atLeft && !e.left) { this.notifyEdge_(EventType.SCROLL_TO_LEFT); }
        if (atRight && !e.right) { this.notifyEdge_(EventType.SCROLL_TO_RIGHT); }
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
