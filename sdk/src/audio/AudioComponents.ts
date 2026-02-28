import { defineComponent } from '../component';
import { AttenuationModel } from './SpatialAudio';

export interface AudioSourceData {
    clip: string;
    bus: string;
    volume: number;
    pitch: number;
    loop: boolean;
    playOnAwake: boolean;
    spatial: boolean;
    minDistance: number;
    maxDistance: number;
    attenuationModel: number;
    rolloff: number;
    priority: number;
    enabled: boolean;
}

export const AudioSource = defineComponent<AudioSourceData>('AudioSource', {
    clip: '',
    bus: 'sfx',
    volume: 1.0,
    pitch: 1.0,
    loop: false,
    playOnAwake: false,
    spatial: false,
    minDistance: 100,
    maxDistance: 1000,
    attenuationModel: AttenuationModel.Inverse,
    rolloff: 1.0,
    priority: 0,
    enabled: true,
});

export interface AudioListenerData {
    enabled: boolean;
}

export const AudioListener = defineComponent<AudioListenerData>('AudioListener', {
    enabled: true,
});
