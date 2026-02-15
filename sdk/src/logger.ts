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
        const prefix = `[${time}] [${levelStr}] [${entry.category}]`;

        const message = entry.data !== undefined
            ? `${entry.message} ${JSON.stringify(entry.data)}`
            : entry.message;

        switch (entry.level) {
            case LogLevel.Debug:
                console.debug(prefix, message);
                break;
            case LogLevel.Info:
                console.log(prefix, message);
                break;
            case LogLevel.Warn:
                console.warn(prefix, message);
                break;
            case LogLevel.Error:
                console.error(prefix, message);
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
