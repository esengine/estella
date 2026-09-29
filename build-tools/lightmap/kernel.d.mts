type F32 = Float32Array<ArrayBufferLike>;
export interface KernelScene {
  positions: F32; triCount: number;
  triUV: F32; triSurface: Int32Array<ArrayBufferLike>; patch: F32; albedo: F32;
  triNormal: F32; twoSided: Uint8Array<ArrayBufferLike>; coverage: F32; backReach: number;
  lumelPosition: F32; lumelNormal: F32; lumelCount: number;
}
export interface BakeKernel {
  /** Threads a pass runs on; any count gives the same answer. */
  threads: number;
  scene(s: KernelScene): void;
  direct(lights: Float64Array, lightCount: number, out: F32): void;
  gather(atlas: F32, atlasSize: number, samples: number, sky: Float64Array, out: F32): void;
  /** Five doubles per file: 1 solved / 2 empty / 0 left to the caller, mean rgb, coverage. */
  textureStats(files: Uint8Array[], cutoffs: number[], toLinear: Float64Array): Float64Array;
  release(): void;
}
export function loadBakeKernel(): Promise<BakeKernel>;
