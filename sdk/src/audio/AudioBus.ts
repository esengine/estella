export interface AudioBusConfig {
    name: string;
    volume?: number;
    muted?: boolean;
    parent?: string;
}

const SMOOTHING_TIME_CONSTANT = 0.015;

export class AudioBus {
    private readonly name_: string;
    private readonly gainNode_: GainNode;
    private muted_: boolean = false;
    private volume_: number = 1.0;
    private children_: AudioBus[] = [];

    constructor(context: AudioContext, config: AudioBusConfig) {
        this.name_ = config.name;
        this.gainNode_ = context.createGain();
        this.volume_ = config.volume ?? 1.0;
        this.muted_ = config.muted ?? false;
        this.gainNode_.gain.value = this.muted_ ? 0 : this.volume_;
    }

    get name(): string { return this.name_; }
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

    connect(destination: AudioBus | AudioNode): void {
        if (destination instanceof AudioBus) {
            this.gainNode_.connect(destination.node);
        } else {
            this.gainNode_.connect(destination);
        }
    }

    addChild(child: AudioBus): void {
        child.connect(this);
        this.children_.push(child);
    }
}
