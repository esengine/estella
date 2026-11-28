// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { App, Plugin } from '../app/app';
import { defineSystem, Schedule } from '../ecs/system';
import { fxPreviewOrPlayMode } from '../ecs/env';
import { registerWorldSceneExportFilter } from '../scene/scene';
import { NodeVisibilityState } from './nodeVisibility';
import { ParticleModelUnitState } from './particleModelUnits';

export class ImportedScenePlugin implements Plugin {
    name = 'importedScene';
    private release_: (() => void) | null = null;

    build(app: App): void {
        const visibility = new NodeVisibilityState(app.world);
        const modelUnits = new ParticleModelUnitState(app.world);
        const releaseFilter = registerWorldSceneExportFilter(app.world,
            (entity, component, data) => visibility.exportData(entity, component, data));
        this.release_ = () => { releaseFilter(); visibility.dispose(); };
        app.addSystemToSchedule(Schedule.Update, defineSystem([], () => modelUnits.update(),
            { name: 'ParticleModelUnitSystem' }), { runIf: fxPreviewOrPlayMode });
        app.addSystemToSchedule(Schedule.PostUpdate, defineSystem([], () => visibility.update(),
            { name: 'NodeVisibilitySystem' }));
    }

    cleanup(): void {
        this.release_?.();
        this.release_ = null;
    }
}
