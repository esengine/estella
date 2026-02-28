export interface PooledAudioNode {
    gain: GainNode;
    panner: StereoPannerNode;
    source: AudioBufferSourceNode | null;
    inUse: boolean;
    priority: number;
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
            priority: 0,
            startTime: 0,
        };
    }

    acquire(priority: number = 0): PooledAudioNode {
        let freeNode = this.pool_.find(n => !n.inUse);

        if (!freeNode) {
            freeNode = this.createNode();
            this.pool_.push(freeNode);
        }

        freeNode.inUse = true;
        freeNode.priority = priority;
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
        node.inUse = false;
        node.priority = 0;
        this.activeCount_--;
    }

    get activeCount(): number {
        return this.activeCount_;
    }

    get capacity(): number {
        return this.pool_.length;
    }
}
