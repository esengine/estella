// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    cocos/ui/pages.ts
 * @brief   `PageView`, `PageViewIndicator` and `ScrollBar`: what sits on top of a `ScrollView`.
 *
 * A page view is a scroll view whose content is a row (or column) of pages, which settles on one when the finger lifts. A scroll bar is a handle
 * that shows where the view is along its content. Both read the scroll view's own offset, so they follow whatever moved it.
 */
import { Component } from '../component';
import { Node } from '../node';
import { Vec2 } from '../math';
import { declareClass } from '../host';
import { ScrollView } from './scrollView';
import { UITransform } from './uiTransform';
import { EventHandler, joinHandlers } from './button';

type Handlers = Array<{ component: string; handler: string; customEventData: string }>;

const PageViewEvent = Object.freeze({ PAGE_TURNING: 'page-turning' });

export class PageView extends ScrollView {
    static readonly SizeMode = Object.freeze({ Unified: 0, Free: 1 });
    static readonly Direction = Object.freeze({ Horizontal: 0, Vertical: 1 });
    static readonly EventType = Object.freeze({ ...ScrollView.EventType, ...PageViewEvent });

    sizeMode = 1;
    direction = 0;
    /** The distance a drag must cover to turn the page, in canvas units. */
    autoPageTurningThreshold = 100;
    /** Seconds a settle takes. */
    pageTurningSpeed = 0.3;
    indicator: PageViewIndicator | null = null;
    pageTargets: Array<Node | null> = [];
    pageHandlers: Handlers = [];
    pageEvents: EventHandler[] = [];

    private page_ = 0;
    private from_ = 0;

    onLoad(): void {
        super.onLoad();
        if (this.pageEvents.length === 0) this.pageEvents = joinHandlers(this.pageTargets, this.pageHandlers);
        this.horizontal = this.direction === 0;
        this.vertical = this.direction === 1;
    }

    onEnable(): void {
        super.onEnable();
        this.node.on(ScrollView.EventType.SCROLL_BEGAN, this.onBegan_, this);
        this.node.on(ScrollView.EventType.TOUCH_UP, this.onLifted_, this);
        this.indicator?.setPageView(this);
    }

    onDisable(): void {
        this.node.off(ScrollView.EventType.SCROLL_BEGAN, this.onBegan_, this);
        this.node.off(ScrollView.EventType.TOUCH_UP, this.onLifted_, this);
        super.onDisable();
    }

    getPages(): Node[] { return this.content?.children ?? []; }
    getCurrentPageIndex(): number { return this.page_; }
    setCurrentPageIndex(index: number): void { this.scrollToPage(index, 0); }

    addPage(page: Node): void { this.content?.addChild(page); this.indicator?.refresh(); }
    insertPage(page: Node, index: number): void { this.content?.addChild(page); page.setSiblingIndex(index); this.indicator?.refresh(); }
    removePage(page: Node): void { if (page.parent === this.content) page.removeFromParent(); this.indicator?.refresh(); }
    removePageAtIndex(index: number): void { const page = this.getPages()[index]; if (page) this.removePage(page); }
    removeAllPages(): void { this.content?.removeAllChildren(); this.indicator?.refresh(); }

    /** Settle on page @p index over @p timeInSecond. */
    scrollToPage(index: number, timeInSecond = this.pageTurningSpeed): void {
        const pages = this.getPages();
        if (pages.length === 0) return;
        const target = Math.min(pages.length - 1, Math.max(0, Math.trunc(index)));
        const offset = this.offsetOf_(pages[target]!);
        if (!offset) return;
        const turned = target !== this.page_;
        this.page_ = target;
        this.scrollToOffset(offset, timeInSecond);
        if (turned) {
            EventHandler.emitEvents(this.pageEvents, this, PageViewEvent.PAGE_TURNING);
            this.node.emit(PageViewEvent.PAGE_TURNING, this);
            this.indicator?.refresh();
        }
    }

    /** The scroll offset that brings @p page to the middle of the view. */
    private offsetOf_(page: Node): Vec2 | null {
        const content = this.content;
        const view = content?.parent?.getComponent(UITransform);
        const size = content?.getComponent(UITransform);
        if (!content || !view || !size) return null;
        const max = this.getMaxScrollOffset();
        const p = page.position;
        const x = p.x + size.width * size.anchorX - view.width / 2;
        const y = size.height * (1 - size.anchorY) - p.y - view.height / 2;
        return new Vec2(Math.min(max.x, Math.max(0, x)), Math.min(max.y, Math.max(0, y)));
    }

    private axis_(offset: Vec2): number { return this.direction === 0 ? offset.x : offset.y; }

    private onBegan_(): void { this.from_ = this.axis_(this.getScrollOffset()); }

    /** On lifting the finger: a drag longer than the threshold turns the page in its direction; a shorter one settles on the nearest. */
    private onLifted_(): void {
        const pages = this.getPages();
        if (pages.length === 0) return;
        const now = this.axis_(this.getScrollOffset());
        const moved = now - this.from_;
        const offsets = pages.map((p) => this.offsetOf_(p)).map((o) => (o ? this.axis_(o) : 0));
        let nearest = 0;
        for (let i = 1; i < offsets.length; i++) if (Math.abs(offsets[i]! - now) < Math.abs(offsets[nearest]! - now)) nearest = i;
        let target = nearest;
        if (Math.abs(moved) >= this.autoPageTurningThreshold && nearest === this.page_) target = this.page_ + (moved > 0 ? 1 : -1);
        this.stopAutoScroll();
        this.scrollToPage(target);
    }
}

/** The dots under a page view. Their number follows the pages and the lit one the current page; drawing them is the scene's own sprites. */
export class PageViewIndicator extends Component {
    static readonly Direction = Object.freeze({ HORIZONTAL: 0, VERTICAL: 1 });
    spacing = 0;
    direction = 0;
    cellSize: { width: number; height: number } = { width: 20, height: 20 };
    private view_: PageView | null = null;

    setPageView(view: PageView | null): void { this.view_ = view; this.refresh(); }
    /** How many pages there are and which one is current. */
    get pageCount(): number { return this.view_?.getPages().length ?? 0; }
    get currentPage(): number { return this.view_?.getCurrentPageIndex() ?? 0; }
    refresh(): void { /* the dots are the scene's own nodes: the count and the lit one are read from pageCount and currentPage */ }
}

export class ScrollBar extends Component {
    static readonly Direction = Object.freeze({ HORIZONTAL: 0, VERTICAL: 1 });
    scrollView: ScrollView | null = null;
    /** The node that slides along the bar. */
    handle: Node | null = null;
    direction = 1;
    enableAutoHide = false;
    autoHideTime = 1;
    private idle_ = 0;

    update(dt: number): void {
        const view = this.scrollView, handle = this.handle;
        if (!view || !handle) return;
        const track = this.node.getComponent(UITransform);
        const content = view.content?.getComponent(UITransform);
        const port = view.content?.parent?.getComponent(UITransform);
        const knob = handle.getComponent(UITransform);
        if (!track || !content || !port || !knob) return;
        const horizontal = this.direction === 0;
        const trackLength = horizontal ? track.width : track.height;
        const contentLength = horizontal ? content.width : content.height;
        const viewLength = horizontal ? port.width : port.height;
        const offset = view.getScrollOffset();
        const max = view.getMaxScrollOffset();
        const travel = horizontal ? max.x : max.y;
        const ratio = travel > 0 ? (horizontal ? offset.x : offset.y) / travel : 0;
        const length = Math.min(trackLength, Math.max(10, contentLength > 0 ? (trackLength * viewLength) / contentLength : trackLength));
        if (horizontal) knob.width = length; else knob.height = length;
        const along = Math.min(1, Math.max(0, ratio)) * (trackLength - length);
        const p = handle.position;
        if (horizontal) handle.setPosition(-trackLength / 2 + length / 2 + along, p.y, p.z);
        else handle.setPosition(p.x, trackLength / 2 - length / 2 - along, p.z);
        // a bar that hides itself shows only while its view moves
        if (this.enableAutoHide) {
            this.idle_ = view.isScrolling() ? 0 : this.idle_ + dt;
            this.node.active = this.idle_ < this.autoHideTime || travel <= 0 ? this.idle_ < this.autoHideTime : false;
        }
    }
}

export function declarePages(): void {
    declareClass(PageView as never, 'PageView', [
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
        { name: 'sizeMode', kind: 'number' },
        { name: 'direction', kind: 'number' },
        { name: 'autoPageTurningThreshold', kind: 'number' },
        { name: 'pageTurningSpeed', kind: 'number' },
        { name: 'indicator', kind: 'component', type: PageViewIndicator },
        { name: 'pageTargets', kind: 'node', array: true },
        { name: 'pageHandlers', kind: 'json' },
    ]);
    declareClass(PageViewIndicator as never, 'PageViewIndicator', [
        { name: 'spacing', kind: 'number' },
        { name: 'direction', kind: 'number' },
        { name: 'cellSize', kind: 'json' },
    ]);
    declareClass(ScrollBar as never, 'ScrollBar', [
        { name: 'scrollView', kind: 'component', type: ScrollView },
        { name: 'handle', kind: 'node' },
        { name: 'direction', kind: 'number' },
        { name: 'enableAutoHide', kind: 'boolean' },
        { name: 'autoHideTime', kind: 'number' },
    ]);
}
