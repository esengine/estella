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
  release(): void;
}
export function loadBakeKernel(): Promise<BakeKernel>;
