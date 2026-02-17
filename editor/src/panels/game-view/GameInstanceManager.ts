import { getEditorInstance } from '../../context/EditorContext';

export type GameState = 'stopped' | 'playing';

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
            this.setState('playing');
            return url;
        } catch (e) {
            this.callbacks_.onError(e instanceof Error ? e : new Error(String(e)));
            return null;
        }
    }

    async stop(): Promise<void> {
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
