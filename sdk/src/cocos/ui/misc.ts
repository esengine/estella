// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    cocos/ui/misc.ts
 * @brief   `SafeArea` and `WebView`.
 *
 * A safe area keeps a node inside the part of the screen a notch or a home bar leaves free: it is a widget whose margins are the screen's safe
 * insets. A web view needs a surface the host provides; none is wired in, so the component keeps its address and events and says once that
 * nothing is shown.
 */
import { Component } from '../component';
import { Node } from '../node';
import { declareClass } from '../host';
import { log } from '../../util/logger';
import { Widget } from './widget';
import { getSafeInsets } from './screen';
import { EventHandler, joinHandlers } from './button';

type Handlers = Array<{ component: string; handler: string; customEventData: string }>;

export class SafeArea extends Component {
    private seen_ = '';

    onEnable(): void { this.seen_ = ''; }

    update(): void {
        const { left, right, top, bottom } = getSafeInsets();
        const key = `${left},${right},${top},${bottom}`;
        if (key === this.seen_) return;
        this.seen_ = key;
        const widget = this.node.getComponent(Widget) ?? this.node.addComponent(Widget)!;
        const flags = Widget.AlignFlags;
        widget.alignFlags |= flags.LEFT | flags.RIGHT | flags.TOP | flags.BOT;
        widget.isAbsLeft = widget.isAbsRight = widget.isAbsTop = widget.isAbsBottom = true;
        widget.left = left;
        widget.right = right;
        widget.top = top;
        widget.bottom = bottom;
    }
}

const WebViewEvent = Object.freeze({ LOADING: 0, LOADED: 1, ERROR: 2 });

export class WebView extends Component {
    static readonly EventType = WebViewEvent;
    url = '';
    webviewTargets: Array<Node | null> = [];
    webviewHandlers: Handlers = [];
    webviewEvents: EventHandler[] = [];
    private warned_ = false;

    onLoad(): void {
        if (this.webviewEvents.length === 0) this.webviewEvents = joinHandlers(this.webviewTargets, this.webviewHandlers);
    }

    onEnable(): void { this.explain_(); }

    /** Ask for an address. There is no web surface to show it on, so it is only kept. */
    loadURL(url: string): void { this.url = url; this.explain_(); }
    setJavascriptInterfaceScheme(_scheme: string): void { /* no page to talk to */ }
    setOnJSCallback(_callback: (view: WebView, url: string) => void): void { /* no page to talk to */ }
    evaluateJS(_code: string): void { /* no page to run it in */ }

    private explain_(): void {
        if (this.warned_ || !this.url) return;
        this.warned_ = true;
        log.warn('cocos', `WebView (${this.node.name}) shows nothing here: this host has no web surface for ${this.url}`);
    }
}

export function declareMisc(): void {
    declareClass(SafeArea as never, 'SafeArea', []);
    declareClass(WebView as never, 'WebView', [
        { name: 'url', kind: 'string' },
        { name: 'webviewTargets', kind: 'node', array: true },
        { name: 'webviewHandlers', kind: 'json' },
    ]);
}
