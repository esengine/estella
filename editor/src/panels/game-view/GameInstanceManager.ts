import { getEditorInstance } from '../../context/EditorContext';

export type GameState = 'stopped' | 'playing' | 'paused';

export interface GameInstanceCallbacks {
    onStateChange(state: GameState): void;
    onError(error: Error): void;
}

export class GameInstanceManager {
    private state_: GameState = 'stopped';
    private callbacks_: GameInstanceCallbacks;
    private previewUrl_: string | null = null;

    constructor(callbacks: GameInstanceCallbacks) {
        this.callbacks_ = callbacks;
    }

    get state(): GameState {
        return this.state_;
    }

    get previewUrl(): string | null {
        return this.previewUrl_;
    }

    async play(): Promise<string | null> {
        if (this.state_ === 'playing') return null;

        const editor = getEditorInstance();
        if (!editor) {
            this.callbacks_.onError(new Error('Editor not available'));
            return null;
        }

        try {
            const url = await editor.startPreviewServer();
            if (!url) {
                this.callbacks_.onError(new Error('Failed to start preview server'));
                return null;
            }
            this.previewUrl_ = url;
            this.setState('playing');
            return url;
        } catch (e) {
            this.callbacks_.onError(e instanceof Error ? e : new Error(String(e)));
            return null;
        }
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
        this.previewUrl_ = null;
        this.setState('stopped');
    }

    async dispose(): Promise<void> {
        await this.stop();
    }

    private setState(state: GameState): void {
        this.state_ = state;
        this.callbacks_.onStateChange(state);
    }
}
