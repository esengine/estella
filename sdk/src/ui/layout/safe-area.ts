// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    ui/layout/safe-area.ts
 * @brief   Safe-area concept — component + the PreUpdate system that pushes
 *          platform safe-area insets into UINode insets, co-located.
 */
import type { App, Plugin } from '../../app/app';
import { getPlatform, isNative, isWeChat, platformDevicePixelRatio } from '../../platform';
import { defineComponent, registerComponent } from '../../ecs/component';
import { Res } from '../../ecs/resource';
import { defineSystem, Schedule } from '../../ecs/system';
import { ScreenLayout, type ScreenLayoutData } from '../core/screen-layout';
import type { UICameraData } from '../core/ui-camera-info';
import { UINode } from '../core/ui-node';
import type { UINodeData } from '../core/ui-node';
import { px } from '../core/dimension';
import { SystemLabel, PluginName } from '../../ecs/systemLabels';
import { subscribeSafeAreaResize } from './safe-area-resize';

export interface SafeAreaData {
    applyTop: boolean;
    applyBottom: boolean;
    applyLeft: boolean;
    applyRight: boolean;
    /**
     * Also clear the host's own overlay — WeChat's capsule menu, which sits
     * INSIDE the safe area: measured on an iPhone 12, its bottom is 29px below
     * `safeArea.top`. Only for a node the overlay actually reaches: this moves
     * the whole node down, so a HUD already above the capsule ends up on it.
     */
    avoidHostMenu: boolean;
}

export const SafeArea = defineComponent<SafeAreaData>('SafeArea', {
    applyTop: true,
    applyBottom: true,
    applyLeft: true,
    applyRight: true,
    avoidHostMenu: false,
});

export interface SafeAreaInsets {
    top: number;
    bottom: number;
    left: number;
    right: number;
}

interface WxGlobal {
    wx?: {
        getSystemInfoSync?(): { safeArea: { top: number; bottom: number; left: number; right: number }; screenWidth: number; screenHeight: number } | undefined;
        getMenuButtonBoundingClientRect?(): { top: number; bottom: number; left: number; right: number } | undefined;
    };
}

/**
 * How far down the host's own overlay reaches, in the CSS pixels the safe area
 * is given in — zero where there is none. No engine offers this: every game
 * converts the rect to layout units by hand, which is the arithmetic the safe
 * area already goes through here.
 */
function hostMenuBottom(): number {
    if (!isWeChat()) return 0;
    const g = globalThis as unknown as WxGlobal;
    const rect = g.wx?.getMenuButtonBoundingClientRect?.();
    return rect && rect.bottom > 0 ? rect.bottom : 0;
}

function getWeChatSafeAreaInsets(): SafeAreaInsets {
    const g = globalThis as unknown as WxGlobal;
    const info = g.wx?.getSystemInfoSync?.();
    if (!info || !info.safeArea) {
        return { top: 0, bottom: 0, left: 0, right: 0 };
    }
    const { safeArea, screenWidth, screenHeight } = info;
    return {
        top: safeArea.top,
        bottom: screenHeight - safeArea.bottom,
        left: safeArea.left,
        right: screenWidth - safeArea.right,
    };
}

function getWebSafeAreaInsets(): SafeAreaInsets {
    if (typeof document === 'undefined' || typeof getComputedStyle === 'undefined') {
        return { top: 0, bottom: 0, left: 0, right: 0 };
    }
    const style = getComputedStyle(document.documentElement);
    return {
        top: parseFloat(style.getPropertyValue('--sat') || '0'),
        bottom: parseFloat(style.getPropertyValue('--sab') || '0'),
        left: parseFloat(style.getPropertyValue('--sal') || '0'),
        right: parseFloat(style.getPropertyValue('--sar') || '0'),
    };
}

function getSafeAreaInsets(): SafeAreaInsets {
    if (isWeChat()) {
        return getWeChatSafeAreaInsets();
    }
    if (isNative()) {
        return getPlatform().safeAreaInsets?.() ?? { top: 0, bottom: 0, left: 0, right: 0 };
    }
    return getWebSafeAreaInsets();
}

export class SafeAreaPlugin implements Plugin {
    name = PluginName.SafeArea;
    dependencies = [PluginName.UILayout];

    private readonly resizeCleanups_ = new WeakMap<App, () => void>();
    private latestResizeCleanup_: (() => void) | null = null;

    cleanup(app?: App): void {
        const release = app ? this.resizeCleanups_.get(app) : this.latestResizeCleanup_;
        if (!release) return;
        if (app) this.resizeCleanups_.delete(app);
        if (release === this.latestResizeCleanup_) this.latestResizeCleanup_ = null;
        release();
    }

    build(app: App): void {
        this.cleanup(app);
        registerComponent('SafeArea', SafeArea);

        const world = app.world;
        // Read on demand rather than once at build: on iOS the env() values are
        // only real after the first layout, and a plugin that built before that
        // would hold zeros for the life of the game.
        let cachedInsets: SafeAreaInsets = { top: 0, bottom: 0, left: 0, right: 0 };
        let cachedMenuBottom = 0;
        let stale = true;
        let prevScreenH = 0;
        let prevLayoutH = 0;

        const release = subscribeSafeAreaResize(() => { stale = true; });
        this.resizeCleanups_.set(app, release);
        this.latestResizeCleanup_ = release;

        app.addSystemToSchedule(Schedule.PreUpdate, defineSystem(
            [Res(ScreenLayout)],
            (layout: ScreenLayoutData) => {
                if (!layout.valid || layout.viewportH === 0) return;
                const safeNodes = world.getEntitiesWithComponents([SafeArea, UINode]);
                if (safeNodes.length === 0) return;

                const layoutH = layout.top - layout.bottom;
                if (layout.viewportH !== prevScreenH || layoutH !== prevLayoutH) {
                    prevScreenH = layout.viewportH;
                    prevLayoutH = layoutH;
                    stale = true;
                }

                // Read native cached OS insets each frame: delayed layout and
                // landscape side changes need not resize the framebuffer.
                // Visit nodes each tick so later scenes acquire their margins.
                if (stale || isNative()) {
                    stale = false;
                    cachedInsets = getSafeAreaInsets();
                    cachedMenuBottom = hostMenuBottom();
                }

                const dpr = platformDevicePixelRatio();
                const insetScale = isWeChat() || isNative() ? (1 / layout.scale) : (dpr / layout.scale);

                // UINode targets (CSS box): safe-area insets map to the node's
                // absolute insets. The node is expected to be position:Absolute.
                for (const entity of safeNodes) {
                    const sa = world.get(entity, SafeArea) as SafeAreaData;
                    const node = world.get(entity, UINode) as UINodeData;

                    // The overlay sits inside the safe area, so this is a floor
                    // on the top inset rather than something added to it.
                    const topPx = sa.avoidHostMenu
                        ? Math.max(cachedInsets.top, cachedMenuBottom)
                        : cachedInsets.top;
                    const top = sa.applyTop ? topPx * insetScale : 0;
                    const bottom = sa.applyBottom ? cachedInsets.bottom * insetScale : 0;
                    const left = sa.applyLeft ? cachedInsets.left * insetScale : 0;
                    const right = sa.applyRight ? cachedInsets.right * insetScale : 0;

                    let changed = false;
                    const set = (k: 'insetLeft' | 'insetTop' | 'insetRight' | 'insetBottom', v: number) => {
                        if (node[k].value !== v || node[k].unit !== 0) { node[k] = px(v); changed = true; }
                    };
                    set('insetLeft', left);
                    set('insetBottom', bottom);
                    set('insetRight', right);
                    set('insetTop', top);

                    if (changed) {
                        world.insert(entity, UINode, node);
                    }
                }
            },
            { name: 'SafeAreaSystem', runWhenPaused: true }
        ), { runBefore: [SystemLabel.UILayout] });
    }
}

export const safeAreaPlugin = new SafeAreaPlugin();
