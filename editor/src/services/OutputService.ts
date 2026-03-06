import type { MainWindowBridge } from '../multiwindow/MainWindowBridge';

export type OutputType = 'command' | 'stdout' | 'stderr' | 'error' | 'success';
export type OutputHandler = (text: string, type: OutputType) => void;

export class OutputService {
    private mainWindowBridge_: MainWindowBridge | null = null;
    private outputHandler_: OutputHandler | null = null;

    setMainWindowBridge(bridge: MainWindowBridge | null): void {
        this.mainWindowBridge_ = bridge;
    }

    registerOutputHandler(handler: OutputHandler): () => void {
        this.outputHandler_ = handler;
        return () => { this.outputHandler_ = null; };
    }

    appendOutput(text: string, type: OutputType): void {
        this.outputHandler_?.(text, type);
        this.mainWindowBridge_?.broadcastOutput(text, type);
    }

    installConsoleCapture(): void {
        const original = {
            log: console.log.bind(console),
            info: console.info.bind(console),
            warn: console.warn.bind(console),
            error: console.error.bind(console),
        };

        const formatArg = (a: unknown): string => {
            if (typeof a === 'string') return a;
            if (a instanceof Error) return `${a.name}: ${a.message}`;
            return JSON.stringify(a, null, 2) ?? String(a);
        };
        const formatArgs = (args: unknown[]) => args.map(formatArg).join(' ');

        const cleanStack = (raw: string | undefined): string => {
            if (!raw) return '';
            return raw.split('\n')
                .filter(line => {
                    const t = line.trim();
                    if (!t || t === 'Error') return false;
                    if (t.includes('/editor/dist/')) return false;
                    return true;
                })
                .map(line => line
                    .replace(/https?:\/\/[^/]+\/@fs/g, '')
                    .replace(/blob:https?:\/\/[^/]+\/[a-f0-9-]+/g, '<extension>')
                )
                .join('\n');
        };

        const INTERNAL_PREFIXES = [
            '[TAURI]', '[INFO]', 'File change:',
        ];

        const forward = (type: 'stdout' | 'stderr' | 'error', args: unknown[], stack?: string) => {
            const first = typeof args[0] === 'string' ? args[0] : '';
            if (INTERNAL_PREFIXES.some(p => first.startsWith(p))) return;

            let text = formatArgs(args);
            if (stack) {
                text += '\n' + stack;
            }
            this.appendOutput(text + '\n', type);
        };

        console.log = (...args) => { original.log(...args); forward('stdout', args); };
        console.info = (...args) => { original.info(...args); forward('stdout', args); };
        console.warn = (...args) => { original.warn(...args); forward('stderr', args, cleanStack(new Error().stack)); };
        console.error = (...args) => { original.error(...args); forward('error', args, cleanStack(new Error().stack)); };
    }
}
