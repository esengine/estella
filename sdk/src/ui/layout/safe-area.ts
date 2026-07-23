// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    ui/layout/safe-area.ts
 * @brief   Safe-area concept — component + the PreUpdate system that pushes
 *          platform safe-area insets into UINode insets, co-located.
 */
import type { App, Plugin } from '../../app';
import { isWeChat, platformDevicePixelRatio } from '../../platform';
import { defineComponent, registerComponent } from '../../component';
import { Res } from '../../resource';
import { defineSystem, Schedule } from '../../system';
import { UICameraInfo } from '../core/ui-camera-info';
import type { UICameraData } from '../core/ui-camera-info';
import { UINode } from '../core/ui-node';
import type { UINodeData } from '../core/ui-node';
import { px } from '../core/dimension';
import { SystemLabel, PluginName } from '../../systemLabels';

export interface SafeAreaData {
    applyTop: boolean;
    applyBottom: boolean;
    applyLeft: boolean;
    applyRight: boolean;
}

export const SafeArea = defineComponent<SafeAreaData>('SafeArea', {
    applyTop: true,
    applyBottom: true,
    applyLeft: true,
    applyRight: true,
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
        onWindowResize?(cb: () => void): void;
    };
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
    // Native (no DOM) falls through to getWebSafeAreaInsets, which returns zero
    // insets when `document` is absent — harmless. When the native shell exposes
    // notch insets (a bridge.safeAreaInsets() seam), gate `isWeChat() || isNative()`
    // here and read them the wechat way (non-DPR-scaled).
    return getWebSafeAreaInsets();
}

export class SafeAreaPlugin implements Plugin {
    name = PluginName.SafeArea;
    dependencies = [PluginName.UILayout];

    private onResize_: (() => void) | null = null;

    cleanup(): void {
        if (this.onResize_ && typeof window !== 'undefined') {
            window.removeEventListener('resize', this.onResize_);
        }
        this.onResize_ = null;
    }

    build(app: App): void {
        registerComponent('SafeArea', SafeArea);

        const world = app.world;
        let cachedInsets: SafeAreaInsets = getSafeAreaInsets();
        let dirty = true;
        let prevScreenH = 0;
        let prevWorldH = 0;

        if (isWeChat()) {
            const g = globalThis as unknown as WxGlobal;
            g.wx?.onWindowResize?.(() => {
                cachedInsets = getSafeAreaInsets();
                dirty = true;
            });
        } else if (typeof window !== 'undefined') {
            this.onResize_ = () => {
                cachedInsets = getSafeAreaInsets();
                dirty = true;
            };
            window.addEventListener('resize', this.onResize_);
        }

        app.addSystemToSchedule(Schedule.PreUpdate, defineSystem(
            [Res(UICameraInfo)],
            (camera: UICameraData) => {
                if (!camera.valid || camera.screenH === 0) return;

                const worldH = camera.worldTop - camera.worldBottom;
                if (camera.screenH !== prevScreenH || worldH !== prevWorldH) {
                    prevScreenH = camera.screenH;
                    prevWorldH = worldH;
                    dirty = true;
                }

                if (!dirty) return;
                dirty = false;

                const dpr = platformDevicePixelRatio();
                const insetScale = isWeChat() ? (worldH / camera.screenH) : (dpr * worldH / camera.screenH);

                // UINode targets (CSS box): safe-area insets map to the node's
                // absolute insets. The node is expected to be position:Absolute.
                for (const entity of world.getEntitiesWithComponents([SafeArea, UINode])) {
                    const sa = world.get(entity, SafeArea) as SafeAreaData;
                    const node = world.get(entity, UINode) as UINodeData;

                    const top = sa.applyTop ? cachedInsets.top * insetScale : 0;
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
            { name: 'SafeAreaSystem' }
        ), { runBefore: [SystemLabel.UILayout] });
    }
}

export const safeAreaPlugin = new SafeAreaPlugin();
