import type { App, Plugin } from '../app';
import { registerComponent } from '../component';
import { defineSystem, Schedule } from '../system';
import { Res } from '../resource';
import { UIRect } from './UIRect';
import { UICameraInfo } from './UICameraInfo';
import type { UICameraData } from './UICameraInfo';
import type { ESEngineModule } from '../wasm';
import type { CppRegistry } from '../wasm';
import { initUIHelpers } from './uiHelpers';

export class UILayoutPlugin implements Plugin {
    build(app: App): void {
        registerComponent('UIRect', UIRect);

        const world = app.world;
        const module = app.wasmModule as ESEngineModule;
        const registry = world.getCppRegistry() as CppRegistry;

        initUIHelpers(module, registry);

        const layoutFn = (camera: UICameraData) => {
            if (!camera.valid) return;
            module.uiLayout_update(
                registry,
                camera.worldLeft, camera.worldBottom,
                camera.worldRight, camera.worldTop,
            );
            module.uiFlexLayout_update(registry);
        };

        app.addSystemToSchedule(Schedule.PreUpdate, defineSystem(
            [Res(UICameraInfo)],
            layoutFn,
            { name: 'UILayoutSystem' }
        ));

        app.addSystemToSchedule(Schedule.PostUpdate, defineSystem(
            [Res(UICameraInfo)],
            layoutFn,
            { name: 'UILayoutLateSystem' }
        ), { runBefore: ['UIRenderOrderSystem'] });
    }
}

export const uiLayoutPlugin = new UILayoutPlugin();
