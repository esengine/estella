import type { App, Plugin } from '../app';
import { registerComponent } from '../component';
import { defineSystem, Schedule } from '../system';
import { UIRect } from './UIRect';
import { ProgressBar } from './ProgressBar';
import type { ProgressBarData } from './ProgressBar';
import { applyDirectionalFill } from './uiHelpers';

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
                    if (!bar.fillEntity || !world.valid(bar.fillEntity)) continue;

                    const value = Math.max(0, Math.min(1, bar.value));
                    applyDirectionalFill(world, bar.fillEntity, bar.direction, value);
                }
            },
            { name: 'ProgressBarSystem' }
        ), { runAfter: ['UILayoutSystem'] });
    }
}

export const progressBarPlugin = new ProgressBarPlugin();
