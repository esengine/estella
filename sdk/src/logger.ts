/**
 * @file    logger.ts
 * @brief   Centralized logging system for SDK
 */

export enum LogLevel {
    Debug = 0,
    Info = 1,
    Warn = 2,
    Error = 3,
}

export interface LogEntry {
    timestamp: number;
    level: LogLevel;
    category: string;
    message: string;
    data?: unknown;
}

export interface LogHandler {
    handle(entry: LogEntry): void;
}

class ConsoleLogHandler implements LogHandler {
    handle(entry: LogEntry): void {
        const time = new Date(entry.timestamp).toISOString().substring(11, 23);
        const levelStr = LogLevel[entry.level].toUpperCase().padEnd(5);

        // One formatted string as the first arg so existing console-based
        // test spies (and simple substring checks) see the whole message.
        // Error instances go through as a separate second arg so the
        // console can render their stack trace natively — JSON.stringify
        // on an Error loses the stack, and on cyclic structures throws.
        let line = `[${time}] [${levelStr}] [${entry.category}] ${entry.message}`;
        let errorArg: Error | undefined;

        if (entry.data !== undefined) {
            if (entry.data instanceof Error) {
                errorArg = entry.data;
            } else {
                try {
                    line += ` ${JSON.stringify(entry.data)}`;
                } catch {
                    line += ` ${String(entry.data)}`;
                }
            }
        }

        const args: unknown[] = [line];
        if (errorArg) args.push(errorArg);

        switch (entry.level) {
            case LogLevel.Debug:
                console.debug(...args);
                break;
            case LogLevel.Info:
                console.log(...args);
                break;
            case LogLevel.Warn:
                console.warn(...args);
                break;
            case LogLevel.Error:
                console.error(...args);
                break;
        }
    }
}

export class Logger {
    private handlers_: LogHandler[] = [];
    private minLevel_ = LogLevel.Info;

    constructor() {
        this.addHandler(new ConsoleLogHandler());
    }

    setMinLevel(level: LogLevel): void {
        this.minLevel_ = level;
    }

    addHandler(handler: LogHandler): void {
        this.handlers_.push(handler);
    }

    removeHandler(handler: LogHandler): void {
        const idx = this.handlers_.indexOf(handler);
        if (idx !== -1) {
            this.handlers_.splice(idx, 1);
        }
    }

    clearHandlers(): void {
        this.handlers_ = [];
    }

    debug(category: string, message: string, data?: unknown): void {
        this.log(LogLevel.Debug, category, message, data);
    }

    info(category: string, message: string, data?: unknown): void {
        this.log(LogLevel.Info, category, message, data);
    }

    warn(category: string, message: string, data?: unknown): void {
        this.log(LogLevel.Warn, category, message, data);
    }

    error(category: string, message: string, data?: unknown): void {
        this.log(LogLevel.Error, category, message, data);
    }

    private log(level: LogLevel, category: string, message: string, data?: unknown): void {
        if (level < this.minLevel_) {
            return;
        }

        const entry: LogEntry = {
            timestamp: Date.now(),
            level,
            category,
            message,
            data,
        };

        for (const handler of this.handlers_) {
            try {
                handler.handle(entry);
            } catch (e) {
                console.error('[Logger] Handler threw error:', e);
            }
        }
    }
}

const defaultLogger = new Logger();

/**
 * Default logger singleton. Prefer this over `console.*` inside the SDK
 * so consumers can install a handler (e.g. an editor log panel) and
 * receive structured `LogEntry`s with category + level.
 *
 * Usage: `import { log } from './logger'; log.warn('physics', 'foo', err);`
 */
export const log = defaultLogger;

export function getLogger(): Logger {
    return defaultLogger;
}

export function setLogLevel(level: LogLevel): void {
    defaultLogger.setMinLevel(level);
}

export function debug(category: string, message: string, data?: unknown): void {
    defaultLogger.debug(category, message, data);
}

export function info(category: string, message: string, data?: unknown): void {
    defaultLogger.info(category, message, data);
}

export function warn(category: string, message: string, data?: unknown): void {
    defaultLogger.warn(category, message, data);
}

export function error(category: string, message: string, data?: unknown): void {
    defaultLogger.error(category, message, data);
}
