/**
 * @file loader.ts
 * @brief ESEngine modular WASM loader
 */

import type {
    EmscriptenModule,
    EmscriptenModuleOptions,
    EngineInstance,
    LoadedModule,
    LoaderOptions,
    ModuleInfo,
} from './types';
import { CORE_MODULE_NAME, getModuleConfig, isValidModuleName } from './config';

type CoreModuleFactory = (options?: EmscriptenModuleOptions) => Promise<EmscriptenModule>;

export class ESEngineLoader {
    private coreModule: EmscriptenModule | null = null;
    private loadedModules: Map<string, LoadedModule> = new Map();
    private basePath: string = './';
    private onProgress?: (module: string, progress: number) => void;

    async initialize(options: LoaderOptions = {}): Promise<EngineInstance> {
        const { modules = [], basePath = './', coreOptions = {}, onProgress } = options;

        this.basePath = basePath.endsWith('/') ? basePath : `${basePath}/`;
        this.onProgress = onProgress;

        await this.loadCoreModule(coreOptions);

        for (const moduleName of modules) {
            await this.loadSideModule(moduleName);
        }

        return this.createEngineInstance();
    }

    private async loadCoreModule(options: EmscriptenModuleOptions = {}): Promise<void> {
        if (this.coreModule) {
            console.warn('[ESEngine] Core module already loaded');
            return;
        }

        const corePath = `${this.basePath}${CORE_MODULE_NAME}.js`;
        this.reportProgress(CORE_MODULE_NAME, 0);

        try {
            const moduleFactory = await this.importCoreModule(corePath);

            this.coreModule = await moduleFactory({
                ...options,
                locateFile: (path: string) => `${this.basePath}${path}`,
            });

            this.reportProgress(CORE_MODULE_NAME, 100);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            throw new Error(`Failed to load core module: ${message}`);
        }
    }

    private async importCoreModule(path: string): Promise<CoreModuleFactory> {
        // Dynamic import returns unknown module shape from external WASM build
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
        const { default: factory } = await import(/* webpackIgnore: true */ path);
        return factory as CoreModuleFactory;
    }

    async loadSideModule(moduleName: string): Promise<LoadedModule> {
        if (!this.coreModule) {
            throw new Error('Core module must be loaded before side modules');
        }

        if (this.loadedModules.has(moduleName)) {
            return this.loadedModules.get(moduleName)!;
        }

        if (!isValidModuleName(moduleName)) {
            throw new Error(`Unknown module: ${moduleName}`);
        }

        const config = getModuleConfig(moduleName)!;
        await this.loadDependencies(config);

        const modulePath = `${this.basePath}${config.file}`;
        this.reportProgress(moduleName, 0);

        try {
            const wasmBinary = await this.fetchWasmBinary(modulePath, moduleName);
            const handle = await this.loadDynamicLibrary(config.file, wasmBinary);

            const loadedModule: LoadedModule = {
                name: moduleName,
                handle,
                config,
            };

            this.loadedModules.set(moduleName, loadedModule);
            this.reportProgress(moduleName, 100);

            return loadedModule;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            throw new Error(`Failed to load side module ${moduleName}: ${message}`);
        }
    }

    private async loadDependencies(config: ModuleInfo): Promise<void> {
        for (const dep of config.dependencies) {
            if (!this.loadedModules.has(dep)) {
                await this.loadSideModule(dep);
            }
        }
    }

    private async fetchWasmBinary(url: string, moduleName: string): Promise<ArrayBuffer> {
        const response = await fetch(url);

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const contentLength = response.headers.get('content-length');
        const total = contentLength ? parseInt(contentLength, 10) : 0;

        if (!response.body || total === 0) {
            return response.arrayBuffer();
        }

        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let loaded = 0;
        let done = false;

        while (!done) {
            const result = await reader.read();
            done = result.done;

            if (result.value) {
                chunks.push(result.value);
                loaded += result.value.length;

                if (total > 0) {
                    this.reportProgress(moduleName, Math.round((loaded / total) * 90));
                }
            }
        }

        const result = new Uint8Array(loaded);
        let offset = 0;
        for (const chunk of chunks) {
            result.set(chunk, offset);
            offset += chunk.length;
        }

        return result.buffer;
    }

    private async loadDynamicLibrary(filename: string, wasmBinary: ArrayBuffer): Promise<unknown> {
        return this.coreModule!.loadDynamicLibrary(filename, {
            loadAsync: true,
            global: true,
            nodelete: true,
            allowUndefined: true,
            fs: {
                readFile: () => new Uint8Array(wasmBinary),
            },
        });
    }

    unloadModule(moduleName: string): boolean {
        if (!this.loadedModules.has(moduleName)) {
            return false;
        }

        this.loadedModules.delete(moduleName);
        return true;
    }

    private reportProgress(module: string, progress: number): void {
        this.onProgress?.(module, progress);
    }

    private createEngineInstance(): EngineInstance {
        const getCoreModule = (): EmscriptenModule => {
            if (!this.coreModule) {
                throw new Error('Core module not initialized');
            }
            return this.coreModule;
        };

        const getLoadedModules = (): ReadonlyMap<string, LoadedModule> => {
            return this.loadedModules;
        };

        return {
            get core(): EmscriptenModule {
                return getCoreModule();
            },

            get loadedModules(): ReadonlyMap<string, LoadedModule> {
                return getLoadedModules();
            },

            loadModule: (name: string) => this.loadSideModule(name),
            unloadModule: (name: string) => this.unloadModule(name),

            getLoadedModuleNames: (): string[] => {
                return Array.from(this.loadedModules.keys());
            },

            isModuleLoaded: (name: string): boolean => {
                return this.loadedModules.has(name);
            },
        };
    }

    static async init(options?: LoaderOptions): Promise<EngineInstance> {
        const loader = new ESEngineLoader();
        return loader.initialize(options);
    }
}
