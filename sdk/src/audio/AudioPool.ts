// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
export interface PooledAudioNode {
    gain: GainNode;
    panner: StereoPannerNode;
    source: AudioBufferSourceNode | null;
    inUse: boolean;
    startTime: number;
}

const DEFAULT_INITIAL_SIZE = 16;

export class AudioPool {
    private readonly context_: AudioContext;
    private readonly pool_: PooledAudioNode[] = [];
    private activeCount_ = 0;

    constructor(context: AudioContext, initialSize: number = DEFAULT_INITIAL_SIZE) {
        this.context_ = context;
        for (let i = 0; i < initialSize; i++) {
            this.pool_.push(this.createNode());
        }
    }

    private createNode(): PooledAudioNode {
        const gain = this.context_.createGain();
        const panner = this.context_.createStereoPanner();
        gain.connect(panner);
        return {
            gain,
            panner,
            source: null,
            inUse: false,
            startTime: 0,
        };
    }

    acquire(): PooledAudioNode {
        let freeNode = this.pool_.find(n => !n.inUse);

        if (!freeNode) {
            freeNode = this.createNode();
            this.pool_.push(freeNode);
        }

        freeNode.inUse = true;
        freeNode.startTime = this.context_.currentTime;
        freeNode.gain.gain.value = 1.0;
        freeNode.panner.pan.value = 0;
        this.activeCount_++;
        return freeNode;
    }

    release(node: PooledAudioNode): void {
        if (!node.inUse) return;
        if (node.source) {
            try { node.source.stop(); } catch (_) { /* already stopped */ }
            node.source.disconnect();
            node.source = null;
        }
        // The panner is re-connected to a bus on every play; without disconnecting
        // it here, reusing this pooled node on a DIFFERENT bus leaves the old
        // panner→bus edge live, so the sound feeds both buses (doubled + wrong
        // volume/ducking). WebAudio dedups same-target connects, not different ones.
        node.panner.disconnect();
        node.inUse = false;
        this.activeCount_--;
    }

    get activeCount(): number {
        return this.activeCount_;
    }

    get capacity(): number {
        return this.pool_.length;
    }
}
