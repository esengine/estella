// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
export {
    WaterBody, WaterForm, Waters, WatersRes, WaterPlugin, waterPlugin, type WaterBodyData, type WaterSample,
} from './waterPlugin';
export { WAVE_SET, waveFade, waveHeight, waveSlope, type WaveParams } from './waves';
export { UnderwaterPlugin, registerUnderwaterEffect } from './underwater';
export { RippleField } from './ripples';
export { Floating, FloatingPlugin, floatingForce, wakeStrength, type FloatingBody, type FloatingData, type FloatingForce } from './floating';
export { WaterZone, WaterField, currentShare, type WaterZoneData, type FieldSample } from './zone';
export { buildOceanMesh, oceanReach, oceanSnap } from './waterMesh';
export { Waterfall, buildWaterfall, waterfallFlight, waterfallHeading, type WaterfallData, type WaterfallLanding, type WaterfallLip } from './waterfall';
export { WATERFALL_SHADER_TEMPLATE } from './waterfallShader';
export { polygonSdf, shoreDamp, type Point2 } from './shore';
export { findBasins, drainPath, type Basin, type BasinMap, type BasinOptions } from './basins';

// Importing this subpath INSTALLS water — see tilemap/index.ts.
import { registerWaterSupport } from './waterSupport';

registerWaterSupport();
