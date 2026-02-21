import type { App, Plugin } from '../app';
import { isWeChat, platformDevicePixelRatio } from '../platform';
import { registerComponent } from '../component';
import { Res } from '../resource';
import { defineSystem, Schedule } from '../system';
import { SafeArea } from './SafeArea';
import type { SafeAreaData } from './SafeArea';
import { UICameraInfo } from './UICameraInfo';
import type { UICameraData } from './UICameraInfo';
import { UIRect } from './UIRect';
import type { UIRectData } from './UIRect';

export interface SafeAreaInsets {
    top: number;
    bottom: number;
    left: number;
    right: number;
}

function getWeChatSafeAreaInsets(): SafeAreaInsets {
    const g = globalThis as any;
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
    return getWebSafeAreaInsets();
}

export class SafeAreaPlugin implements Plugin {
    build(app: App): void {
        registerComponent('SafeArea', SafeArea);

        const world = app.world;
        let cachedInsets: SafeAreaInsets = getSafeAreaInsets();
        let dirty = true;
        let prevScreenH = 0;
        let prevWorldH = 0;

        if (isWeChat()) {
            const g = globalThis as any;
            g.wx?.onWindowResize?.(() => {
                cachedInsets = getSafeAreaInsets();
                dirty = true;
            });
        } else if (typeof window !== 'undefined') {
            window.addEventListener('resize', () => {
                cachedInsets = getSafeAreaInsets();
                dirty = true;
            });
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

                const entities = world.getEntitiesWithComponents([SafeArea, UIRect]);
                for (const entity of entities) {
                    const sa = world.get(entity, SafeArea) as SafeAreaData;
                    const rect = world.get(entity, UIRect) as UIRectData;

                    const top = sa.applyTop ? cachedInsets.top * insetScale : 0;
                    const bottom = sa.applyBottom ? cachedInsets.bottom * insetScale : 0;
                    const left = sa.applyLeft ? cachedInsets.left * insetScale : 0;
                    const right = sa.applyRight ? cachedInsets.right * insetScale : 0;

                    let changed = false;
                    if (rect.offsetMin.x !== left || rect.offsetMin.y !== bottom) {
                        rect.offsetMin = { x: left, y: bottom };
                        changed = true;
                    }
                    if (rect.offsetMax.x !== -right || rect.offsetMax.y !== -top) {
                        rect.offsetMax = { x: -right, y: -top };
                        changed = true;
                    }

                    if (changed) {
                        world.insert(entity, UIRect, rect);
                    }
                }
            },
            { name: 'SafeAreaSystem' }
        ), { runBefore: ['UILayoutSystem'] });
    }
}

export const safeAreaPlugin = new SafeAreaPlugin();
