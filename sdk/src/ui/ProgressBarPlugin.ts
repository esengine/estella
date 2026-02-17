import type { App, Plugin } from '../app';
import { registerComponent } from '../component';
import { defineSystem, Schedule } from '../system';
import type { Entity } from '../types';
import { UIRect } from './UIRect';
import type { UIRectData } from './UIRect';
import { ProgressBar, ProgressBarDirection } from './ProgressBar';
import type { ProgressBarData } from './ProgressBar';

export class ProgressBarPlugin implements Plugin {
    build(app: App): void {
        registerComponent('ProgressBar', ProgressBar);

        const world = app.world;

        app.addSystemToSchedule(Schedule.PreUpdate, defineSystem(
            [],
            () => {
                const entities = world.getEntitiesWithComponents([ProgressBar, UIRect]);
                for (const entity of entities) {
                    const bar = world.get(entity, ProgressBar) as ProgressBarData;
                    if (!bar.fillEntity || !world.valid(bar.fillEntity as Entity)) continue;

                    const fillEntity = bar.fillEntity as Entity;
                    if (!world.has(fillEntity, UIRect)) continue;

                    const fillRect = world.get(fillEntity, UIRect) as UIRectData;
                    const value = Math.max(0, Math.min(1, bar.value));

                    switch (bar.direction) {
                        case ProgressBarDirection.LeftToRight:
                            fillRect.anchorMin = { x: 0, y: 0 };
                            fillRect.anchorMax = { x: value, y: 1 };
                            break;
                        case ProgressBarDirection.RightToLeft:
                            fillRect.anchorMin = { x: 1 - value, y: 0 };
                            fillRect.anchorMax = { x: 1, y: 1 };
                            break;
                        case ProgressBarDirection.BottomToTop:
                            fillRect.anchorMin = { x: 0, y: 0 };
                            fillRect.anchorMax = { x: 1, y: value };
                            break;
                        case ProgressBarDirection.TopToBottom:
                            fillRect.anchorMin = { x: 0, y: 1 - value };
                            fillRect.anchorMax = { x: 1, y: 1 };
                            break;
                    }

                    fillRect.offsetMin = { x: 0, y: 0 };
                    fillRect.offsetMax = { x: 0, y: 0 };
                    world.insert(fillEntity, UIRect, fillRect);
                }
            },
            { name: 'ProgressBarSystem' }
        ));
    }
}

export const progressBarPlugin = new ProgressBarPlugin();
