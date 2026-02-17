import type { App, Plugin } from '../app';
import { registerComponent } from '../component';
import { defineSystem, Schedule } from '../system';
import type { Entity } from '../types';
import { SafeArea } from './SafeArea';
import type { SafeAreaData } from './SafeArea';
import { UIRect } from './UIRect';
import type { UIRectData } from './UIRect';

export interface SafeAreaInsets {
    top: number;
    bottom: number;
    left: number;
    right: number;
}

function getSafeAreaInsets(): SafeAreaInsets {
    if (typeof document === 'undefined') {
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

export class SafeAreaPlugin implements Plugin {
    build(app: App): void {
        registerComponent('SafeArea', SafeArea);

        const world = app.world;
        let cachedInsets: SafeAreaInsets = { top: 0, bottom: 0, left: 0, right: 0 };
        let frameCount = 0;

        app.addSystemToSchedule(Schedule.PreUpdate, defineSystem(
            [],
            () => {
                if (frameCount++ % 60 === 0) {
                    cachedInsets = getSafeAreaInsets();
                }

                const entities = world.getEntitiesWithComponents([SafeArea, UIRect]);
                for (const entity of entities) {
                    const sa = world.get(entity, SafeArea) as SafeAreaData;
                    const rect = world.get(entity, UIRect) as UIRectData;

                    let changed = false;
                    const top = sa.applyTop ? cachedInsets.top : 0;
                    const bottom = sa.applyBottom ? cachedInsets.bottom : 0;
                    const left = sa.applyLeft ? cachedInsets.left : 0;
                    const right = sa.applyRight ? cachedInsets.right : 0;

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
        ));
    }
}

export const safeAreaPlugin = new SafeAreaPlugin();
