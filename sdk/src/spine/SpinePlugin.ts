import type { Plugin } from '../app';
import type { App } from '../app';
import { Time } from '../resource';
import { Schedule } from '../system';
import type { SystemDef } from '../system';
import { initSpineCppAPI, SpineCpp } from './SpineCppAPI';
import { SpineManager } from './SpineManager';
import type { SpineWasmProvider } from './SpineModuleLoader';
import { createSpineFactories } from './SpineModuleLoader';

export class SpinePlugin implements Plugin {
    private spineManager_: SpineManager | null;
    private provider_: SpineWasmProvider | null;
    private app_: App | null = null;

    constructor(managerOrProvider?: SpineManager | SpineWasmProvider) {
        if (managerOrProvider instanceof SpineManager) {
            this.spineManager_ = managerOrProvider;
            this.provider_ = null;
        } else {
            this.spineManager_ = null;
            this.provider_ = managerOrProvider ?? null;
        }
    }

    get spineManager(): SpineManager | null {
        return this.spineManager_;
    }

    setSpineManager(manager: SpineManager): void {
        this.spineManager_ = manager;
        if (this.app_) {
            const pipeline = this.app_.pipeline;
            pipeline?.addPreFlushCallback((registry) => {
                manager.submitMeshes(registry._cpp);
            });
        }
    }

    build(app: App): void {
        this.app_ = app;
        const coreModule = app.wasmModule!;
        initSpineCppAPI(coreModule);

        if (!this.spineManager_ && this.provider_) {
            const factories = createSpineFactories(this.provider_);
            this.spineManager_ = new SpineManager(coreModule, factories);
        }

        const self = this;

        const spineUpdateSystem: SystemDef = {
            _id: Symbol('SpineUpdateSystem'),
            _name: 'SpineUpdateSystem',
            _params: [],
            _fn: () => {
                const cppRegistry = app.world.getCppRegistry();
                if (!cppRegistry) return;
                const time = app.getResource(Time);
                SpineCpp.update({ _cpp: cppRegistry }, time.delta);
                self.spineManager_?.updateAnimations(time.delta);
            },
        };

        app.addSystemToSchedule(Schedule.PreUpdate, spineUpdateSystem);

        if (this.spineManager_) {
            const manager = this.spineManager_;
            const pipeline = app.pipeline;
            pipeline?.addPreFlushCallback((registry) => {
                manager.submitMeshes(registry._cpp);
            });
        }
    }
}
