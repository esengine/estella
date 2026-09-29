// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
export { unwrapLightmapUV, type UnwrapOptions, type UnwrapResult } from './unwrap';
export { bakeLightmap, bakeLightmapSteps, bakeRunner, LIGHTMAP_RANGE, encodeLightmap, decodeLightmap, lightmapImage,
         type BakeOptions, type BakeResult, type BakeScene, type BakeJob, type BakeStep } from './bake';
export { skyRadiance, type SkySpec } from './sky';
export type { BakeSurface } from './atlas';
export type { BakeLight } from './solve';
export { solveProbes, probeAt, type ProbeGrid } from './probes';
export { captureReflection, flatSky, type CapturedPanorama, type SkyRadiance }
    from './reflection';
export { bakeHoldsStill, type BakeMobility } from './mobility';
export { bakeFingerprint, type BakeInputs } from './fingerprint';
export { BakedLighting, type BakedLightingData } from './components';
export { bakeLightOf, bakeLightForward, type AuthoredLight, type BakeLightContribution }
    from './lights';
export { BAKE_DEFAULTS } from './bake';
export { shBasis, convolveCosine, evalIrradianceSH, SH_BASIS_SCALE, SH_COSINE_BAND } from './sh';
export { panoramaDirection, panoramaUV } from './panorama';
