/**
 * @file types.ts
 * @brief Type definitions for ESEngine Web Loader
 */

export interface ModuleInfo {
    name: string;
    description: string;
    file: string;
    dependencies: readonly string[];
}

export interface LoadedModule {
    name: string;
    handle: unknown;
    config: ModuleInfo;
}

export interface LoaderOptions {
    modules?: string[];
    basePath?: string;
    coreOptions?: EmscriptenModuleOptions;
    onProgress?: (module: string, progress: number) => void;
}

export interface EmscriptenModuleOptions {
    locateFile?: (path: string, prefix: string) => string;
    print?: (text: string) => void;
    printErr?: (text: string) => void;
    canvas?: HTMLCanvasElement | null;
    [key: string]: unknown;
}

export interface DynamicLibraryOptions {
    loadAsync?: boolean;
    global?: boolean;
    nodelete?: boolean;
    allowUndefined?: boolean;
    fs?: {
        readFile?: (path: string) => Uint8Array;
    };
}

export interface EmscriptenModule {
    loadDynamicLibrary(
        path: string,
        options?: DynamicLibraryOptions
    ): Promise<unknown>;

    ccall<T = unknown>(
        ident: string,
        returnType: string | null,
        argTypes: string[],
        args: unknown[]
    ): T;

    cwrap<T extends (...args: unknown[]) => unknown>(
        ident: string,
        returnType: string | null,
        argTypes: string[]
    ): T;

    HEAPF32: Float32Array;
    HEAPU8: Uint8Array;
    HEAPU32: Uint32Array;
    HEAP32: Int32Array;

    _malloc(size: number): number;
    _free(ptr: number): void;

    canvas: HTMLCanvasElement | null;
    ctx: WebGLRenderingContext | WebGL2RenderingContext | null;
}

export interface EngineInstance {
    readonly core: EmscriptenModule;
    readonly loadedModules: ReadonlyMap<string, LoadedModule>;
    loadModule(name: string): Promise<LoadedModule>;
    unloadModule(name: string): boolean;
    getLoadedModuleNames(): string[];
    isModuleLoaded(name: string): boolean;
}

export type ModuleName = 'es_ui' | 'es_font_sdf' | 'es_font_bitmap';

export const MODULE_NAMES = {
    UI: 'es_ui' as const,
    FONT_SDF: 'es_font_sdf' as const,
    FONT_BITMAP: 'es_font_bitmap' as const,
};
