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
        const visibility = new NodeVisibilityState();
        const modelUnits = new ParticleModelUnitState();
        this.release_ = registerWorldSceneExportFilter(app.world,
            (entity, component, data) => visibility.exportData(entity, component, data));
        app.addSystemToSchedule(Schedule.Update, defineSystem([], () => {
            app.world.ensureTransformsComposed();
            modelUnits.update(app.world);
        }, { name: 'ParticleModelUnitSystem' }), { runIf: fxPreviewOrPlayMode });
        app.addSystemToSchedule(Schedule.PostUpdate, defineSystem([], () => visibility.update(app.world),
            { name: 'NodeVisibilitySystem' }));
    }

    cleanup(): void {
        this.release_?.();
        this.release_ = null;
    }
}
