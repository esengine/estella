// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    cocos/view.ts
 * @brief   `view` / `View` and `screen`: the size of what the player sees and of the window it is in.
 *
 * Both are read-mostly. The visible size is whatever the UI camera shows (the frame loop feeds it in; see ui/screen.ts), which in
 * an imported scene is the canvas the script sees. The design resolution is what the project asked for; a script that never set
 * one gets the visible size. Fitting design to window is the engine's screen layout, so the policy setters record the choice and
 * leave the fitting to it.
 *
 * `screen.windowSize` is in physical pixels, as in Cocos, and `view.getFrameSize()` is the same in CSS pixels.
 */
import { platformDevicePixelRatio } from '../platform';
import { Emitter } from './emitter';
import { Rect, Size, Vec2 } from './math';
import { getVisibleSize, getWindowPixels, onScreenChange } from './ui/screen';

const ResolutionPolicy = Object.freeze({ EXACT_FIT: 0, NO_BORDER: 1, SHOW_ALL: 2, FIXED_HEIGHT: 3, FIXED_WIDTH: 4, UNKNOWN: 5 });

const dpr = (): number => platformDevicePixelRatio() || 1;

export class View extends Emitter {
    static readonly instance: View = new View();
    static readonly ResolutionPolicy = ResolutionPolicy;

    private design_: Size | null = null;
    private policy_: number = ResolutionPolicy.UNKNOWN;
    private autoFullScreen_ = false;
    private orientation_ = 3;

    constructor() {
        super();
        // The two sizes change in one place; the events Cocos scripts listen for are named here.
        onScreenChange((kind) => {
            if (kind === 'visible') this.emit('canvas-resize');
            else this.emit('canvas-resize');
        });
    }

    /** The area the player sees, in canvas units. */
    getVisibleSize(): Size { const v = getVisibleSize(); return new Size(v.width, v.height); }
    getVisibleSizeInPixel(): Size { const v = getVisibleSize(); const s = this.getScaleX(); return new Size(v.width * s, v.height * s); }
    /** The visible area is centred on the world origin, as the engine's screen is. */
    getVisibleOrigin(): Vec2 { const v = getVisibleSize(); return new Vec2(-v.width / 2, -v.height / 2); }
    getVisibleOriginInPixel(): Vec2 { const v = this.getVisibleSizeInPixel(); return new Vec2(-v.width / 2, -v.height / 2); }
    getViewportRect(): Rect { const w = getWindowPixels(); return new Rect(0, 0, w.width, w.height); }

    getDesignResolutionSize(): Size { return this.design_ ? this.design_.clone() : this.getVisibleSize(); }
    setDesignResolutionSize(width: number, height: number, policy: number = this.policy_): void {
        this.design_ = new Size(width, height);
        this.policy_ = policy;
        this.emit('design-resolution-changed');
    }
    getResolutionPolicy(): number { return this.policy_; }
    setResolutionPolicy(policy: number): void { this.policy_ = policy; }

    /** The window in CSS pixels. */
    getFrameSize(): Size { const w = getWindowPixels(); return new Size(w.width / dpr(), w.height / dpr()); }
    setFrameSize(_w: number, _h: number): void { /* the host's window */ }
    getCanvasSize(): Size { const w = getWindowPixels(); return new Size(w.width, w.height); }
    setCanvasSize(_w: number, _h: number): void { /* the host's canvas */ }

    /** Window pixels per canvas unit. */
    getScaleX(): number { const v = getVisibleSize(); return v.width > 0 ? getWindowPixels().width / v.width : 1; }
    getScaleY(): number { const v = getVisibleSize(); return v.height > 0 ? getWindowPixels().height / v.height : 1; }
    getDevicePixelRatio(): number { return dpr(); }

    isAutoFullScreenEnabled(): boolean { return this.autoFullScreen_; }
    enableAutoFullScreen(enabled: boolean): void { this.autoFullScreen_ = enabled; }
    isAntiAliasEnabled(): boolean { return true; }
    enableAntiAlias(_enabled: boolean): void { /* a configuration of the engine */ }
    resizeWithBrowserSize(_enabled: boolean): void { /* the host decides */ }
    adjustViewportMeta(_enabled: boolean): void { /* the page's */ }
    setOrientation(orientation: number): void { this.orientation_ = orientation; }
    get orientation(): number { return this.orientation_; }
}

export const view = View.instance;

class Screen extends Emitter {
    /** The window in physical pixels. */
    get windowSize(): Size { const w = getWindowPixels(); return new Size(w.width, w.height); }
    get devicePixelRatio(): number { return dpr(); }
    get supportsFullScreen(): boolean { return false; }
    isFullScreen(): boolean { return false; }
    requestFullScreen(): Promise<void> { return Promise.resolve(); }
    exitFullScreen(): Promise<void> { return Promise.resolve(); }
    autoFullScreen(): Promise<void> { return Promise.resolve(); }
    get resolution(): Size { return this.windowSize; }

    constructor() {
        super();
        onScreenChange((kind) => { if (kind === 'window') this.emit('window-resize', this.windowSize.width, this.windowSize.height); });
    }
}

export const screen = new Screen();
export { ResolutionPolicy };
