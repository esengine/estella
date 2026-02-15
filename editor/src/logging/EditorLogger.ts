/**
 * @file    EditorLogger.ts
 * @brief   Centralized logging system for editor
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
    level: LogLevel;
    message: string;
    timestamp: number;
    context?: string;
    data?: unknown;
}

export type LogHandler = (entry: LogEntry) => void;

class EditorLoggerImpl {
    private handlers_: Set<LogHandler> = new Set();
    private minLevel_: LogLevel = 'info';
    private context_: string | null = null;

    private levelPriority: Record<LogLevel, number> = {
        debug: 0,
        info: 1,
        warn: 2,
        error: 3,
    };

    setMinLevel(level: LogLevel): void {
        this.minLevel_ = level;
    }

    setContext(context: string | null): void {
        this.context_ = context;
    }

    addHandler(handler: LogHandler): () => void {
        this.handlers_.add(handler);
        return () => this.handlers_.delete(handler);
    }

    removeHandler(handler: LogHandler): void {
        this.handlers_.delete(handler);
    }

    clearHandlers(): void {
        this.handlers_.clear();
    }

    debug(message: string, data?: unknown): void {
        this.log('debug', message, data);
    }

    info(message: string, data?: unknown): void {
        this.log('info', message, data);
    }

    warn(message: string, data?: unknown): void {
        this.log('warn', message, data);
    }

    error(message: string, data?: unknown): void {
        this.log('error', message, data);
    }

    private log(level: LogLevel, message: string, data?: unknown): void {
        if (this.levelPriority[level] < this.levelPriority[this.minLevel_]) {
            return;
        }

        const entry: LogEntry = {
            level,
            message,
            timestamp: Date.now(),
            context: this.context_ ?? undefined,
            data,
        };

        for (const handler of this.handlers_) {
            try {
                handler(entry);
            } catch (err) {
                console.error('[EditorLogger] Handler error:', err);
            }
        }
    }
}

export const EditorLogger = new EditorLoggerImpl();

export function createConsoleHandler(): LogHandler {
    return (entry: LogEntry) => {
        const prefix = entry.context ? `[${entry.context}]` : '';
        const message = `${prefix} ${entry.message}`;

        switch (entry.level) {
            case 'debug':
                console.debug(message, entry.data ?? '');
                break;
            case 'info':
                console.log(message, entry.data ?? '');
                break;
            case 'warn':
                console.warn(message, entry.data ?? '');
                break;
            case 'error':
                console.error(message, entry.data ?? '');
                break;
        }
    };
}

export function createToastHandler(showToast: (message: string, type: 'info' | 'warning' | 'error') => void): LogHandler {
    return (entry: LogEntry) => {
        if (entry.level === 'error') {
            showToast(entry.message, 'error');
        } else if (entry.level === 'warn') {
            showToast(entry.message, 'warning');
        }
    };
}
