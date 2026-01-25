/**
 * ESEngine TypeScript SDK - WASM Bridge
 *
 * Provides interface for interacting with the C++ WASM module.
 */

/**
 * ESEngine WASM Module interface.
 * Defines the functions exported from the C++ code.
 */
export interface ESEngineModule {
  // Memory management
  HEAPF32: Float32Array;
  HEAPU8: Uint8Array;
  HEAPU32: Uint32Array;
  _malloc(size: number): number;
  _free(ptr: number): void;

  // Core lifecycle
  _es_init(width: number, height: number): void;
  _es_update(deltaTime: number): void;
  _es_render(): void;
  _es_shutdown(): void;

  // Input handling
  _es_on_touch(type: number, x: number, y: number): void;
  _es_on_key?(keyCode: number, pressed: number): void;

  // Renderer
  _es_renderer_clear?(r: number, g: number, b: number, a: number): void;
  _es_renderer_begin_scene?(vpMatrixPtr: number): void;
  _es_renderer_end_scene?(): void;
  _es_renderer_draw_quad?(
    x: number,
    y: number,
    w: number,
    h: number,
    r: number,
    g: number,
    b: number,
    a: number
  ): void;
  _es_renderer_draw_quad_textured?(
    x: number,
    y: number,
    w: number,
    h: number,
    texId: number,
    r: number,
    g: number,
    b: number,
    a: number
  ): void;

  // Emscripten canvas/context
  canvas?: HTMLCanvasElement;

  // Runtime methods
  ccall(
    name: string,
    returnType: string | null,
    argTypes: string[],
    args: unknown[]
  ): unknown;
  cwrap(
    name: string,
    returnType: string | null,
    argTypes: string[]
  ): (...args: unknown[]) => unknown;
}

/**
 * WASM load options.
 */
export interface WasmLoadOptions {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
}

/**
 * Global reference to the loaded WASM module.
 */
let wasmModule: ESEngineModule | null = null;

/**
 * Check if WASM module is loaded.
 */
export function isWasmLoaded(): boolean {
  return wasmModule !== null;
}

/**
 * Get the loaded WASM module.
 * Throws if module is not loaded.
 */
export function getWasmModule(): ESEngineModule {
  if (!wasmModule) {
    throw new Error('WASM module not loaded. Call loadWasmModule first.');
  }
  return wasmModule;
}

/**
 * Set the WASM module reference.
 * Called when the module is loaded externally.
 */
export function setWasmModule(module: ESEngineModule): void {
  wasmModule = module;
}

/**
 * Load the WASM module from the specified path.
 *
 * @param wasmPath Path to the .js loader file (e.g., 'esengine.js')
 * @param options Canvas and dimensions for WebGL context
 * @returns Promise that resolves to the loaded module
 */
export async function loadWasmModule(
  wasmPath: string,
  options?: WasmLoadOptions
): Promise<ESEngineModule> {
  if (wasmModule) {
    return wasmModule;
  }

  return new Promise((resolve, reject) => {
    // Create Module configuration
    // Emscripten will add exports like _malloc, _free to this object
    const moduleConfig: Partial<ESEngineModule> & Record<string, unknown> = {
      // Pass canvas element to Emscripten so it can create WebGL context
      canvas: options?.canvas,
      locateFile: (path: string) => {
        // Handle .wasm file location
        if (path.endsWith('.wasm')) {
          const basePath = wasmPath.substring(0, wasmPath.lastIndexOf('/') + 1);
          return basePath + path;
        }
        return path;
      },
      print: (text: string) => console.log('[ESEngine C++]', text),
      printErr: (text: string) => console.error('[ESEngine C++]', text),
    };

    // onRuntimeInitialized is called after all exports are attached to moduleConfig
    moduleConfig.onRuntimeInitialized = () => {
      // moduleConfig now has _malloc, _free, etc. attached by Emscripten
      wasmModule = moduleConfig as ESEngineModule;

      // Initialize C++ renderer if options provided
      if (options && wasmModule._es_init) {
        wasmModule._es_init(options.width, options.height);
      }

      resolve(wasmModule);
    };

    // Set global Module before loading script
    (window as unknown as { Module: unknown }).Module = moduleConfig;

    // Load the WASM loader script
    const script = document.createElement('script');
    script.src = wasmPath;
    script.onerror = () => reject(new Error(`Failed to load WASM module: ${wasmPath}`));
    document.head.appendChild(script);
  });
}

/**
 * Initialize C++ renderer (call after WASM is loaded).
 */
export function initWasmRenderer(width: number, height: number): void {
  const module = getWasmModule();
  if (module._es_init) {
    module._es_init(width, height);
  }
}

/**
 * Allocate memory in WASM heap and copy a Float32Array.
 */
export function allocFloat32Array(data: Float32Array): number {
  const module = getWasmModule();
  const ptr = module._malloc(data.length * 4);
  module.HEAPF32.set(data, ptr >> 2);
  return ptr;
}

/**
 * Allocate memory in WASM heap and copy a Uint8Array.
 */
export function allocUint8Array(data: Uint8Array): number {
  const module = getWasmModule();
  const ptr = module._malloc(data.length);
  module.HEAPU8.set(data, ptr);
  return ptr;
}

/**
 * Free previously allocated WASM memory.
 */
export function freePtr(ptr: number): void {
  if (ptr && wasmModule) {
    wasmModule._free(ptr);
  }
}

/**
 * Execute a callback with a temporary Float32Array allocation.
 */
export function withFloat32Array<T>(
  data: Float32Array,
  callback: (ptr: number) => T
): T {
  const ptr = allocFloat32Array(data);
  try {
    return callback(ptr);
  } finally {
    freePtr(ptr);
  }
}
