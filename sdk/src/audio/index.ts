// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
export { Audio, AudioAPI, type AudioBufferStats } from './Audio';
export { AudioBus, type AudioBusConfig } from './AudioBus';
export { AudioMixer, type AudioMixerConfig, type BusDuckRule } from './AudioMixer';
export {
    buildEffectNodes, makeImpulseResponse, parseBusEffects,
    type BusEffectDef, type FilterEffectDef, type ReverbEffectDef, type CompressorEffectDef,
    type EffectNodes,
} from './BusEffects';
export {
    parseAudioProjectConfig, applyAudioProjectConfig,
    type AudioProjectConfig, type AudioBusDecl,
} from './AudioProjectConfig';
export { AudioPool, type PooledAudioNode } from './AudioPool';
export { AudioPlugin, audioPlugin, type AudioPluginConfig } from './AudioPlugin';
export { AudioSource, AudioListener, type AudioSourceData, type AudioListenerData } from './AudioComponents';
export { AttenuationModel, calculateAttenuation, calculatePanning, type SpatialAudioConfig } from './SpatialAudio';
export { WebAudioBackend } from './WebAudioBackend';
export { MiniGameAudioBackend } from './MiniGameAudioBackend';
export { NativeAudioBackend } from './NativeAudioBackend';
export type { AudioHandle, AudioBufferHandle, PlayConfig, PlatformAudioBackend, AudioBackendInitOptions } from './PlatformAudioBackend';
