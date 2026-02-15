import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Logger, LogLevel, type LogHandler, type LogEntry } from '../src/logger';

describe('Logger', () => {
    let logger: Logger;
    let mockHandler: LogHandler;
    let capturedEntries: LogEntry[];

    beforeEach(() => {
        logger = new Logger();
        logger.clearHandlers();
        capturedEntries = [];

        mockHandler = {
            handle: (entry: LogEntry) => {
                capturedEntries.push(entry);
            },
        };

        logger.addHandler(mockHandler);
    });

    describe('log levels', () => {
        it('should log debug messages', () => {
            logger.setMinLevel(LogLevel.Debug);
            logger.debug('Test', 'Debug message');

            expect(capturedEntries).toHaveLength(1);
            expect(capturedEntries[0].level).toBe(LogLevel.Debug);
            expect(capturedEntries[0].message).toBe('Debug message');
        });

        it('should log info messages', () => {
            logger.info('Test', 'Info message');

            expect(capturedEntries).toHaveLength(1);
            expect(capturedEntries[0].level).toBe(LogLevel.Info);
        });

        it('should log warn messages', () => {
            logger.warn('Test', 'Warning message');

            expect(capturedEntries).toHaveLength(1);
            expect(capturedEntries[0].level).toBe(LogLevel.Warn);
        });

        it('should log error messages', () => {
            logger.error('Test', 'Error message');

            expect(capturedEntries).toHaveLength(1);
            expect(capturedEntries[0].level).toBe(LogLevel.Error);
        });
    });

    describe('filtering', () => {
        it('should filter messages below min level', () => {
            logger.setMinLevel(LogLevel.Warn);

            logger.debug('Test', 'Debug');
            logger.info('Test', 'Info');
            logger.warn('Test', 'Warning');
            logger.error('Test', 'Error');

            expect(capturedEntries).toHaveLength(2);
            expect(capturedEntries[0].level).toBe(LogLevel.Warn);
            expect(capturedEntries[1].level).toBe(LogLevel.Error);
        });

        it('should default to Info level', () => {
            const defaultLogger = new Logger();
            defaultLogger.clearHandlers();
            defaultLogger.addHandler(mockHandler);

            defaultLogger.debug('Test', 'Debug');
            defaultLogger.info('Test', 'Info');

            expect(capturedEntries).toHaveLength(1);
            expect(capturedEntries[0].level).toBe(LogLevel.Info);
        });
    });

    describe('categories', () => {
        it('should include category in log entry', () => {
            logger.info('SDK:AssetServer', 'Message');

            expect(capturedEntries[0].category).toBe('SDK:AssetServer');
        });

        it('should support different categories', () => {
            logger.info('SDK:World', 'Message 1');
            logger.info('SDK:Query', 'Message 2');

            expect(capturedEntries[0].category).toBe('SDK:World');
            expect(capturedEntries[1].category).toBe('SDK:Query');
        });
    });

    describe('data', () => {
        it('should include data in log entry', () => {
            logger.info('Test', 'Message', { key: 'value' });

            expect(capturedEntries[0].data).toEqual({ key: 'value' });
        });

        it('should handle undefined data', () => {
            logger.info('Test', 'Message');

            expect(capturedEntries[0].data).toBeUndefined();
        });

        it('should handle complex data', () => {
            const data = {
                nested: { value: 42 },
                array: [1, 2, 3],
                string: 'test',
            };

            logger.info('Test', 'Message', data);

            expect(capturedEntries[0].data).toEqual(data);
        });
    });

    describe('timestamps', () => {
        it('should include timestamp in log entry', () => {
            const before = Date.now();
            logger.info('Test', 'Message');
            const after = Date.now();

            expect(capturedEntries[0].timestamp).toBeGreaterThanOrEqual(before);
            expect(capturedEntries[0].timestamp).toBeLessThanOrEqual(after);
        });
    });

    describe('handlers', () => {
        it('should support multiple handlers', () => {
            const entries1: LogEntry[] = [];
            const entries2: LogEntry[] = [];

            logger.addHandler({ handle: (e) => entries1.push(e) });
            logger.addHandler({ handle: (e) => entries2.push(e) });

            logger.info('Test', 'Message');

            expect(entries1).toHaveLength(1);
            expect(entries2).toHaveLength(1);
            expect(capturedEntries).toHaveLength(1);
        });

        it('should remove handlers', () => {
            const handler2 = { handle: vi.fn() };
            logger.addHandler(handler2);

            logger.removeHandler(mockHandler);
            logger.info('Test', 'Message');

            expect(capturedEntries).toHaveLength(0);
            expect(handler2.handle).toHaveBeenCalledTimes(1);
        });

        it('should clear all handlers', () => {
            logger.clearHandlers();
            logger.info('Test', 'Message');

            expect(capturedEntries).toHaveLength(0);
        });

        it('should catch handler errors', () => {
            const errorHandler: LogHandler = {
                handle: () => {
                    throw new Error('Handler error');
                },
            };

            logger.addHandler(errorHandler);

            expect(() => {
                logger.info('Test', 'Message');
            }).not.toThrow();

            expect(capturedEntries).toHaveLength(1);
        });
    });

    describe('console handler', () => {
        it('should log to console by default', () => {
            const consoleSpy = vi.spyOn(console, 'log');
            const newLogger = new Logger();

            newLogger.info('Test', 'Message');

            expect(consoleSpy).toHaveBeenCalled();
            consoleSpy.mockRestore();
        });
    });

    describe('global functions', () => {
        it('should export convenience functions', async () => {
            const { getLogger, setLogLevel, debug, info, warn, error } = await import('../src/logger');

            expect(getLogger).toBeDefined();
            expect(setLogLevel).toBeDefined();
            expect(debug).toBeDefined();
            expect(info).toBeDefined();
            expect(warn).toBeDefined();
            expect(error).toBeDefined();
        });
    });
});
