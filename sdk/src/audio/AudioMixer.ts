// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { AudioBus, type AudioBusConfig } from './AudioBus';

export interface AudioMixerConfig {
    masterVolume?: number;
    musicVolume?: number;
    sfxVolume?: number;
    uiVolume?: number;
    voiceVolume?: number;
}

/**
 * Sidechain ducking rule: while `trigger` carries signal, the target bus's
 * duck stage ramps to `amount`; when it falls silent, it ramps back to 1.
 */
export interface BusDuckRule {
    trigger: string;
    /** Duck level 0..1 while the trigger bus is active. */
    amount: number;
    /** Ramp-down time constant in seconds (default 0.05). */
    attack?: number;
    /** Ramp-up time constant in seconds (default 0.4). */
    release?: number;
    /** RMS level (0..1) above which the trigger counts as active (default 0.003). */
    threshold?: number;
}

interface DuckState {
    rule: BusDuckRule;
    analyser: AnalyserNode;
    data: Uint8Array;
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

    /** Registered bus names, in creation order (master first). */
    busNames(): string[] {
        return [...this.buses_.keys()];
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

    // -- sidechain ducking ----------------------------------------------------

    private ducks_ = new Map<string, DuckState>();

    /** Install (or clear with null) the duck rule targeting `target`. */
    setDucking(target: string, rule: BusDuckRule | null): boolean {
        const targetBus = this.buses_.get(target);
        if (!targetBus) return false;
        const existing = this.ducks_.get(target);
        if (existing) {
            existing.analyser.disconnect();
            this.ducks_.delete(target);
            targetBus.duckTo(1, existing.rule.release ?? 0.4);
        }
        if (!rule) return true;
        const trigger = this.buses_.get(rule.trigger);
        if (!trigger) return false;
        // Sink-only tap on the trigger's OUTPUT (post-volume), so a muted
        // trigger bus stops ducking.
        const analyser = this.context_.createAnalyser();
        analyser.fftSize = 256;
        trigger.node.connect(analyser);
        this.ducks_.set(target, { rule: { ...rule }, analyser, data: new Uint8Array(analyser.fftSize) });
        return true;
    }

    getDucking(target: string): BusDuckRule | null {
        const d = this.ducks_.get(target);
        return d ? { ...d.rule } : null;
    }

    /** Per-frame: measure each trigger's RMS and ramp its target's duck stage. */
    updateDucking(): void {
        for (const [target, d] of this.ducks_) {
            const targetBus = this.buses_.get(target);
            if (!targetBus) continue;
            // lib.dom narrowed getByteTimeDomainData to Uint8Array<ArrayBuffer> in
            // TS 5.7; ours is a plain Uint8Array (ArrayBufferLike) — safe to cast.
            d.analyser.getByteTimeDomainData(d.data as Uint8Array<ArrayBuffer>);
            let sum = 0;
            for (let i = 0; i < d.data.length; i++) {
                const v = (d.data[i] - 128) / 128;
                sum += v * v;
            }
            const rms = Math.sqrt(sum / d.data.length);
            const active = rms > (d.rule.threshold ?? 0.003);
            targetBus.duckTo(
                active ? d.rule.amount : 1,
                active ? (d.rule.attack ?? 0.05) : (d.rule.release ?? 0.4)
            );
        }
    }
}
