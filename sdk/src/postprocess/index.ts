// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
export { PostProcessStack } from './PostProcessStack';
export type { PassConfig } from './PostProcessStack';
export { PostProcess, PostProcessAPI, initPostProcessAPI, shutdownPostProcessAPI, syncStackToWasm } from './PostProcessAPI';
export { outputTransformCode } from './PostProcessAPI';
export type { OutputTransform, HdrFormat } from './PostProcessAPI';
export { postProcessEffects } from './effects';
export { POSTPROCESS_VERTEX } from './shaders';
export {
    type EffectDef,
    type ComputeEffectSource,
    type EffectUniformDef,
    registerEffect,
    getEffectDef,
    getEffectTypes,
    getAllEffectDefs,
} from './effects';
export {
    signedDistanceBox,
    signedDistanceSphere,
    computeVolumeFactor,
    blendVolumeEffects,
    type ActiveVolume,
    type VolumeTransform,
    type BlendedEffect,
} from './volumeBlending';
export {
    postProcessVolumeSystem,
    cleanupVolumeSystem,
    PostProcessVolumeConfigResource,
    type PostProcessVolumeConfig,
} from './volumeSystem';
export { PostProcessPlugin, postProcessPlugin } from './PostProcessPlugin';
export {
    registerWeatherPreset,
    weatherPresetId,
    weatherPresetNames,
    blendWeather,
    currentWeather,
    WeatherDrive,
    WEATHER_CLEAR,
    WEATHER_MIST,
    WEATHER_OVERCAST,
    WEATHER_RAIN,
    WEATHER_STORM,
    WEATHER_SNOW,
    WEATHER_NONE,
    type WeatherState,
    type WeatherPreset,
} from './weather';
export { skyClockState, setSkyClockState, type SkyClockState } from './skyClock';
export { timeOfDayAt, sunPosition, currentTimeOfDay, TimeDrive, type TimeOfDayState } from './timeOfDay';
