// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
export { Audio, AudioAPI, type AudioBufferStats, type MusicLayers, type MusicLayersConfig } from './Audio';
export { SoundEvents, SoundEventPlayback, type SoundEventEmitter, type SoundEventHandle,
    type SoundEventStatus, type SoundEventRejection, type SoundEventStats } from './SoundEventPlayback';
export { parseSoundEvent, SoundEventSelector, type SoundEventAsset, type SoundEventClip,
    type SoundEventMode, type SoundEventSelection, type SoundEventSelectionResult } from './SoundEvent';
export { AudioBus, type AudioBusConfig } from './AudioBus';
export { AudioMixer, BUILTIN_AUDIO_BUSES, builtinBusVolume, type AudioMixerConfig, type BusDuckRule } from './AudioMixer';
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
export { AudioSource, AudioListener, SoundEventSource, type AudioSourceData, type AudioListenerData, type SoundEventSourceData } from './AudioComponents';
export { triggerSoundEventSource, stopSoundEventSource } from './SoundEventSource';
export { AttenuationModel, calculateAttenuation, calculatePanning, spatialDistance, type SpatialAudioConfig } from './SpatialAudio';
export { WebAudioBackend } from './WebAudioBackend';
export { MiniGameAudioBackend } from './MiniGameAudioBackend';
export { NativeAudioBackend } from './NativeAudioBackend';
export type { AudioHandle, AudioBufferHandle, PlayConfig, PlatformAudioBackend, AudioBackendInitOptions, AudioDelivery, AudioLoadType, AudioLoadOptions } from './PlatformAudioBackend';
