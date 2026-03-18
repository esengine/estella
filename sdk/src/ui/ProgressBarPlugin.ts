import type { App, Plugin } from '../app';
import { registerComponent } from '../component';
import { defineSystem, Schedule } from '../system';
import { UIRect } from './UIRect';
import type { UIRectData } from './UIRect';
import { ProgressBar } from './ProgressBar';
import type { ProgressBarData } from './ProgressBar';
import { applyDirectionalFill, withChildEntity } from './uiHelpers';
import { SystemLabel, PluginName } from '../systemLabels';

export class ProgressBarPlugin implements Plugin {
    name = 'progressBar';
    dependencies = [PluginName.UILayout];

    build(app: App): void {
        registerComponent('ProgressBar', ProgressBar);

        const world = app.world;

        app.addSystemToSchedule(Schedule.PreUpdate, defineSystem(
            [],
            () => {
                const entities = world.getEntitiesWithComponents([ProgressBar, UIRect]);
                for (const entity of entities) {
                    const bar = world.get(entity, ProgressBar) as ProgressBarData;
                    const value = Math.max(0, Math.min(1, bar.value));

                    withChildEntity(world, bar.fillEntity, (fill) => {
                        applyDirectionalFill(world, fill, bar.direction, value);
                    });
                }
            },
            { name: 'ProgressBarSystem' }
        ), { runAfter: [SystemLabel.UILayout] });
    }
}

export const progressBarPlugin = new ProgressBarPlugin();
