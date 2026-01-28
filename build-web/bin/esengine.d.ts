// TypeScript bindings for emscripten-generated code.  Automatically generated at compile time.
declare namespace RuntimeExports {
    /**
     * @param {string|null=} returnType
     * @param {Array=} argTypes
     * @param {Array=} args
     * @param {Object=} opts
     */
    function ccall(ident: any, returnType?: (string | null) | undefined, argTypes?: any[] | undefined, args?: any[] | undefined, opts?: any | undefined): any;
    /**
     * @param {string=} returnType
     * @param {Array=} argTypes
     * @param {Object=} opts
     */
    function cwrap(ident: any, returnType?: string | undefined, argTypes?: any[] | undefined, opts?: any | undefined): (...args: any[]) => any;
    let HEAPF32: any;
    let HEAPU8: any;
    let HEAPU32: any;
    function FS_createPath(...args: any[]): any;
    function FS_createDataFile(...args: any[]): any;
    function FS_preloadFile(parent: any, name: any, url: any, canRead: any, canWrite: any, dontCreateFile: any, canOwn: any, preFinish: any): Promise<void>;
    function FS_unlink(...args: any[]): any;
    function FS_createLazyFile(...args: any[]): any;
    function FS_createDevice(...args: any[]): any;
    function addRunDependency(id: any): void;
    function removeRunDependency(id: any): void;
}
interface WasmModule {
  _es_app_init(): void;
  _free(_0: number): void;
  _malloc(_0: number): number;
  _es_init(_0: number, _1: number): void;
  _es_update(_0: number): void;
  _es_render(): void;
  _es_shutdown(): void;
  _es_on_touch(_0: number, _1: number, _2: number): void;
  _es_on_key(_0: number, _1: number): void;
  _es_renderer_clear(_0: number, _1: number, _2: number, _3: number): void;
  _es_renderer_begin_scene(_0: number): void;
  _es_renderer_end_scene(): void;
  _es_renderer_draw_quad(_0: number, _1: number, _2: number, _3: number, _4: number, _5: number, _6: number, _7: number): void;
  _es_renderer_draw_quad_textured(_0: number, _1: number, _2: number, _3: number, _4: number, _5: number, _6: number, _7: number, _8: number): void;
}

interface EmbindModule {
}

export type MainModule = WasmModule & typeof RuntimeExports & EmbindModule;
export default function MainModuleFactory (options?: unknown): Promise<MainModule>;
