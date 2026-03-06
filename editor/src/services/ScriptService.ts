import { ScriptLoader } from '../scripting';
import { showErrorToast } from '../ui/Toast';
import type { OutputService } from './OutputService';
import type { EditorStore } from '../store/EditorStore';

export class ScriptService {
    private scriptLoader_: ScriptLoader | null = null;
    private projectPath_: string | null;
    private outputService_: OutputService;
    private store_: EditorStore;

    constructor(projectPath: string | null, outputService: OutputService, store: EditorStore) {
        this.projectPath_ = projectPath;
        this.outputService_ = outputService;
        this.store_ = store;
    }

    get scriptLoader(): ScriptLoader | null {
        return this.scriptLoader_;
    }

    async initialize(): Promise<void> {
        if (!this.projectPath_) return;

        this.scriptLoader_ = new ScriptLoader({
            projectPath: this.projectPath_,
            onCompileError: (errors) => {
                console.error('Script compilation errors:', errors);
                const msg = errors.map(e => `${e.file}:${e.line} - ${e.message}`).join('\n');
                showErrorToast('Script compile failed', msg);
                for (const e of errors) {
                    this.outputService_.appendOutput(`${e.file}:${e.line}:${e.column} - ${e.message}`, 'error');
                }
            },
            onCompileSuccess: () => {
                this.store_.notifyChange();
            },
        });

        try {
            await this.scriptLoader_.initialize();
            await this.scriptLoader_.compile();
            await this.scriptLoader_.watch();
        } catch (err) {
            console.error('Failed to initialize scripts:', err);
        }
    }

    getCompiledScripts(): string | null {
        return this.scriptLoader_?.getCompiledCode() ?? null;
    }

    async reload(): Promise<boolean> {
        if (!this.scriptLoader_) {
            if (this.projectPath_) {
                await this.initialize();
                return true;
            }
            return false;
        }
        return this.scriptLoader_.reload();
    }

    dispose(): void {
        this.scriptLoader_?.dispose();
    }
}
