// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
export { unwrapLightmapUV, type UnwrapOptions, type UnwrapResult } from './unwrap';
export { bakeLightmap, type BakeOptions, type BakeResult } from './bake';
export type { BakeSurface } from './atlas';
export type { BakeLight } from './solve';
export { solveProbes, probeAt, type ProbeGrid } from './probes';
export { bakeHoldsStill, type BakeMobility } from './mobility';
export { shBasis, convolveCosine, evalIrradianceSH, SH_BASIS_SCALE, SH_COSINE_BAND } from './sh';
