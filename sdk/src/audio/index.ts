// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
export { Audio, AudioAPI } from './Audio';
export { AudioBus, type AudioBusConfig } from './AudioBus';
export { AudioMixer, type AudioMixerConfig, type BusDuckRule } from './AudioMixer';
export {
    buildEffectNodes, makeImpulseResponse, parseBusEffects,
    type BusEffectDef, type FilterEffectDef, type ReverbEffectDef, type CompressorEffectDef,
    type EffectNodes,
} from './BusEffects';
export { AudioPool, type PooledAudioNode } from './AudioPool';
export { AudioPlugin, audioPlugin, type AudioPluginConfig } from './AudioPlugin';
export { AudioSource, AudioListener, type AudioSourceData, type AudioListenerData } from './AudioComponents';
export { AttenuationModel, calculateAttenuation, calculatePanning, type SpatialAudioConfig } from './SpatialAudio';
export { WebAudioBackend } from './WebAudioBackend';
export { WeChatAudioBackend } from './WeChatAudioBackend';
export type { AudioHandle, AudioBufferHandle, PlayConfig, PlatformAudioBackend, AudioBackendInitOptions } from './PlatformAudioBackend';
