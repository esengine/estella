import { AudioBus, type AudioBusConfig } from './AudioBus';

export interface AudioMixerConfig {
    masterVolume?: number;
    musicVolume?: number;
    sfxVolume?: number;
    uiVolume?: number;
    voiceVolume?: number;
}

const DEFAULT_MUSIC_VOLUME = 0.8;

export class AudioMixer {
    readonly master: AudioBus;
    readonly music: AudioBus;
    readonly sfx: AudioBus;
    readonly ui: AudioBus;
    readonly voice: AudioBus;

    private readonly context_: AudioContext;
    private readonly buses_ = new Map<string, AudioBus>();

    constructor(context: AudioContext, config: AudioMixerConfig = {}) {
        this.context_ = context;

        this.master = new AudioBus(context, { name: 'master', volume: config.masterVolume ?? 1.0 });
        this.master.connect(context.destination);

        this.music = new AudioBus(context, { name: 'music', volume: config.musicVolume ?? DEFAULT_MUSIC_VOLUME });
        this.master.addChild(this.music);

        this.sfx = new AudioBus(context, { name: 'sfx', volume: config.sfxVolume ?? 1.0 });
        this.master.addChild(this.sfx);

        this.ui = new AudioBus(context, { name: 'ui', volume: config.uiVolume ?? 1.0 });
        this.master.addChild(this.ui);

        this.voice = new AudioBus(context, { name: 'voice', volume: config.voiceVolume ?? 1.0 });
        this.master.addChild(this.voice);

        this.buses_.set('master', this.master);
        this.buses_.set('music', this.music);
        this.buses_.set('sfx', this.sfx);
        this.buses_.set('ui', this.ui);
        this.buses_.set('voice', this.voice);
    }

    getBus(name: string): AudioBus | undefined {
        return this.buses_.get(name);
    }

    createBus(config: AudioBusConfig): AudioBus {
        const bus = new AudioBus(this.context_, config);
        const parent = config.parent ? this.buses_.get(config.parent) : this.master;
        if (parent) {
            parent.addChild(bus);
        }
        this.buses_.set(config.name, bus);
        return bus;
    }
}
