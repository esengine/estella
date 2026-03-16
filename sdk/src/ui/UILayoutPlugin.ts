import type { App, Plugin } from '../app';
import { registerComponent } from '../component';
import { defineSystem, Schedule } from '../system';
import { Res } from '../resource';
import { UIRect } from './UIRect';
import { UIRenderer } from './UIRenderer';
import { UICameraInfo } from './UICameraInfo';
import type { UICameraData } from './UICameraInfo';
import { UILayoutGeneration } from './UILayoutGeneration';
import type { UILayoutGenerationData } from './UILayoutGeneration';
import type { ESEngineModule } from '../wasm';
import type { CppRegistry } from '../wasm';
import { initUIHelpers } from './uiHelpers';

export class UILayoutPlugin implements Plugin {
    name = 'uiLayout';

    build(app: App): void {
        registerComponent('UIRect', UIRect);
        registerComponent('UIRenderer', UIRenderer);

        const world = app.world;
        const module = app.wasmModule as ESEngineModule;
        const registry = world.getCppRegistry() as CppRegistry;

        initUIHelpers(module, registry);

        const layoutGen: UILayoutGenerationData = { generation: 0 };
        app.insertResource(UILayoutGeneration, layoutGen);

        const layoutFn = (camera: UICameraData) => {
            if (!camera.valid) return;
            module.uiLayout_update(
                registry,
                camera.worldLeft, camera.worldBottom,
                camera.worldRight, camera.worldTop,
            );
            module.transform_update(registry);
            layoutGen.generation++;
        };

        const layoutOnlyFn = (camera: UICameraData) => {
            if (!camera.valid) return;
            module.uiLayout_update(
                registry,
                camera.worldLeft, camera.worldBottom,
                camera.worldRight, camera.worldTop,
            );
            layoutGen.generation++;
        };

        app.addSystemToSchedule(Schedule.PreUpdate, defineSystem(
            [Res(UICameraInfo)],
            layoutFn,
            { name: 'UILayoutSystem' }
        ));

        app.addSystemToSchedule(Schedule.PostUpdate, defineSystem(
            [Res(UICameraInfo)],
            layoutOnlyFn,
            { name: 'UILayoutLateSystem' }
        ), { runBefore: ['UIRenderOrderSystem'] });

        app.addSystemToSchedule(Schedule.PostUpdate, defineSystem(
            [],
            () => { module.transform_update(registry); },
            { name: 'UITransformFinalSystem' }
        ), { runAfter: ['ScrollViewSystem', 'ListViewSystem'], runBefore: ['UIRenderOrderSystem'] });
    }
}

export const uiLayoutPlugin = new UILayoutPlugin();
