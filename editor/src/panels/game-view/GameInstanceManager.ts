export type GameState = 'stopped' | 'playing' | 'paused';

export interface GameInstanceCallbacks {
    onStateChange(state: GameState): void;
    onError(error: Error): void;
}

export class GameInstanceManager {
    private state_: GameState = 'stopped';
    private callbacks_: GameInstanceCallbacks;

    constructor(callbacks: GameInstanceCallbacks) {
        this.callbacks_ = callbacks;
    }

    get state(): GameState {
        return this.state_;
    }

    pause(): void {
        if (this.state_ === 'playing') {
            this.setState('paused');
        }
    }

    resume(): void {
        if (this.state_ === 'paused') {
            this.setState('playing');
        }
    }

    async stop(): Promise<void> {
        this.setState('stopped');
    }

    async dispose(): Promise<void> {
        await this.stop();
    }

    setState(state: GameState): void {
        this.state_ = state;
        this.callbacks_.onStateChange(state);
    }
}
