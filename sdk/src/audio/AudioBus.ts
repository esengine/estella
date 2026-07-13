// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    AudioBus.ts
 * @brief   One mixer bus: input → [effect inserts…] → duck → gain(volume) → parent.
 *
 * Sources and child buses connect to `input`; `node` is the OUTPUT gain (what
 * volume/mute act on, and what parents/analysers tap). The duck stage is a
 * separate gain so sidechain ducking never fights the user's volume setting.
 */

import { buildEffectNodes, type BusEffectDef, type EffectNodes } from './BusEffects';

export interface AudioBusConfig {
    name: string;
    volume?: number;
    muted?: boolean;
    parent?: string;
}

const SMOOTHING_TIME_CONSTANT = 0.015;

export class AudioBus {
    private readonly name_: string;
    private readonly context_: AudioContext;
    private readonly inputNode_: GainNode;
    private readonly duckNode_: GainNode;
    private readonly gainNode_: GainNode;
    private muted_: boolean = false;
    private volume_: number = 1.0;
    private children_: AudioBus[] = [];
    private effectDefs_: BusEffectDef[] = [];
    private effectNodes_: EffectNodes[] = [];

    constructor(context: AudioContext, config: AudioBusConfig) {
        this.name_ = config.name;
        this.context_ = context;
        this.inputNode_ = context.createGain();
        this.duckNode_ = context.createGain();
        this.gainNode_ = context.createGain();
        this.inputNode_.connect(this.duckNode_);
        this.duckNode_.connect(this.gainNode_);
        this.volume_ = Math.max(0, Math.min(1, config.volume ?? 1.0));
        this.muted_ = config.muted ?? false;
        this.gainNode_.gain.value = this.muted_ ? 0 : this.volume_;
    }

    get name(): string { return this.name_; }
    /** Entry node — sources and child buses connect HERE. */
    get input(): GainNode { return this.inputNode_; }
    /** Output gain (volume/mute stage) — parents and analyser taps connect FROM here. */
    get node(): GainNode { return this.gainNode_; }

    get volume(): number { return this.volume_; }
    set volume(v: number) {
        this.volume_ = Math.max(0, Math.min(1, v));
        if (!this.muted_) {
            this.gainNode_.gain.setTargetAtTime(
                this.volume_,
                this.gainNode_.context.currentTime,
                SMOOTHING_TIME_CONSTANT
            );
        }
    }

    get muted(): boolean { return this.muted_; }
    set muted(m: boolean) {
        this.muted_ = m;
        this.gainNode_.gain.setTargetAtTime(
            m ? 0 : this.volume_,
            this.gainNode_.context.currentTime,
            SMOOTHING_TIME_CONSTANT
        );
    }

    /** The declarative insert chain currently realized on this bus. */
    get effects(): BusEffectDef[] { return this.effectDefs_.map(e => ({ ...e })); }

    /** Idempotently replace the insert chain: input → e1 → … → duck. */
    setEffects(defs: BusEffectDef[]): void {
        this.inputNode_.disconnect();
        for (const fx of this.effectNodes_) fx.output.disconnect();
        this.effectDefs_ = defs.map(e => ({ ...e }));
        this.effectNodes_ = defs.map(d => buildEffectNodes(this.context_, d));
        let prev: AudioNode = this.inputNode_;
        for (const fx of this.effectNodes_) {
            prev.connect(fx.input);
            prev = fx.output;
        }
        prev.connect(this.duckNode_);
    }

    /** Sidechain duck stage: ramp toward `level` with the given time constant. */
    duckTo(level: number, timeConstant: number): void {
        this.duckNode_.gain.setTargetAtTime(
            Math.max(0, Math.min(1, level)),
            this.duckNode_.context.currentTime,
            Math.max(0.001, timeConstant)
        );
    }

    connect(destination: AudioBus | AudioNode): void {
        if (destination instanceof AudioBus) {
            this.gainNode_.connect(destination.input);
        } else {
            this.gainNode_.connect(destination);
        }
    }

    addChild(child: AudioBus): void {
        child.connect(this);
        this.children_.push(child);
    }
}
