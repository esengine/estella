import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EditorLogger, createConsoleHandler, createToastHandler, type LogEntry } from '../../logging';

describe('EditorLogger', () => {
    beforeEach(() => {
        EditorLogger.clearHandlers();
        EditorLogger.setMinLevel('debug');
        EditorLogger.setContext(null);
    });

    it('logs messages to registered handlers', () => {
        const entries: LogEntry[] = [];
        const handler = (entry: LogEntry) => entries.push(entry);

        EditorLogger.addHandler(handler);
        EditorLogger.info('Test message');

        expect(entries.length).toBe(1);
        expect(entries[0].level).toBe('info');
        expect(entries[0].message).toBe('Test message');
    });

    it('logs all severity levels', () => {
        const entries: LogEntry[] = [];
        EditorLogger.addHandler((entry) => entries.push(entry));

        EditorLogger.debug('Debug message');
        EditorLogger.info('Info message');
        EditorLogger.warn('Warning message');
        EditorLogger.error('Error message');

        expect(entries.length).toBe(4);
        expect(entries[0].level).toBe('debug');
        expect(entries[1].level).toBe('info');
        expect(entries[2].level).toBe('warn');
        expect(entries[3].level).toBe('error');
    });

    it('filters messages below min level', () => {
        const entries: LogEntry[] = [];
        EditorLogger.addHandler((entry) => entries.push(entry));
        EditorLogger.setMinLevel('warn');

        EditorLogger.debug('Debug message');
        EditorLogger.info('Info message');
        EditorLogger.warn('Warning message');
        EditorLogger.error('Error message');

        expect(entries.length).toBe(2);
        expect(entries[0].level).toBe('warn');
        expect(entries[1].level).toBe('error');
    });

    it('includes context in log entries', () => {
        const entries: LogEntry[] = [];
        EditorLogger.addHandler((entry) => entries.push(entry));
        EditorLogger.setContext('TestContext');

        EditorLogger.info('Test message');

        expect(entries[0].context).toBe('TestContext');
    });

    it('includes data in log entries', () => {
        const entries: LogEntry[] = [];
        EditorLogger.addHandler((entry) => entries.push(entry));

        const data = { foo: 'bar', count: 42 };
        EditorLogger.info('Test message', data);

        expect(entries[0].data).toEqual(data);
    });

    it('includes timestamp in log entries', () => {
        const entries: LogEntry[] = [];
        EditorLogger.addHandler((entry) => entries.push(entry));

        const before = Date.now();
        EditorLogger.info('Test message');
        const after = Date.now();

        expect(entries[0].timestamp).toBeGreaterThanOrEqual(before);
        expect(entries[0].timestamp).toBeLessThanOrEqual(after);
    });

    it('removes handlers', () => {
        const entries: LogEntry[] = [];
        const handler = (entry: LogEntry) => entries.push(entry);

        const unsubscribe = EditorLogger.addHandler(handler);
        EditorLogger.info('First message');

        unsubscribe();
        EditorLogger.info('Second message');

        expect(entries.length).toBe(1);
        expect(entries[0].message).toBe('First message');
    });

    it('handles handler errors gracefully', () => {
        const entries: LogEntry[] = [];
        const goodHandler = (entry: LogEntry) => entries.push(entry);
        const badHandler = () => { throw new Error('Handler error'); };

        EditorLogger.addHandler(badHandler);
        EditorLogger.addHandler(goodHandler);

        expect(() => EditorLogger.info('Test message')).not.toThrow();
        expect(entries.length).toBe(1);
    });

    it('supports multiple handlers', () => {
        const entries1: LogEntry[] = [];
        const entries2: LogEntry[] = [];

        EditorLogger.addHandler((entry) => entries1.push(entry));
        EditorLogger.addHandler((entry) => entries2.push(entry));

        EditorLogger.info('Test message');

        expect(entries1.length).toBe(1);
        expect(entries2.length).toBe(1);
        expect(entries1[0].message).toBe('Test message');
        expect(entries2[0].message).toBe('Test message');
    });

    it('clears all handlers', () => {
        const entries: LogEntry[] = [];
        EditorLogger.addHandler((entry) => entries.push(entry));
        EditorLogger.info('First message');

        EditorLogger.clearHandlers();
        EditorLogger.info('Second message');

        expect(entries.length).toBe(1);
    });
});

describe('createConsoleHandler', () => {
    it('logs to console at appropriate levels', () => {
        const consoleSpy = {
            debug: vi.spyOn(console, 'debug').mockImplementation(() => {}),
            log: vi.spyOn(console, 'log').mockImplementation(() => {}),
            warn: vi.spyOn(console, 'warn').mockImplementation(() => {}),
            error: vi.spyOn(console, 'error').mockImplementation(() => {}),
        };

        const handler = createConsoleHandler();

        handler({ level: 'debug', message: 'Debug', timestamp: Date.now() });
        handler({ level: 'info', message: 'Info', timestamp: Date.now() });
        handler({ level: 'warn', message: 'Warn', timestamp: Date.now() });
        handler({ level: 'error', message: 'Error', timestamp: Date.now() });

        expect(consoleSpy.debug).toHaveBeenCalledWith(' Debug', '');
        expect(consoleSpy.log).toHaveBeenCalledWith(' Info', '');
        expect(consoleSpy.warn).toHaveBeenCalledWith(' Warn', '');
        expect(consoleSpy.error).toHaveBeenCalledWith(' Error', '');

        consoleSpy.debug.mockRestore();
        consoleSpy.log.mockRestore();
        consoleSpy.warn.mockRestore();
        consoleSpy.error.mockRestore();
    });
});

describe('createToastHandler', () => {
    it('shows toasts for warnings and errors only', () => {
        const toasts: Array<{ message: string; type: string }> = [];
        const showToast = (message: string, type: 'info' | 'warning' | 'error') => {
            toasts.push({ message, type });
        };

        const handler = createToastHandler(showToast);

        handler({ level: 'debug', message: 'Debug', timestamp: Date.now() });
        handler({ level: 'info', message: 'Info', timestamp: Date.now() });
        handler({ level: 'warn', message: 'Warning', timestamp: Date.now() });
        handler({ level: 'error', message: 'Error', timestamp: Date.now() });

        expect(toasts.length).toBe(2);
        expect(toasts[0]).toEqual({ message: 'Warning', type: 'warning' });
        expect(toasts[1]).toEqual({ message: 'Error', type: 'error' });
    });
});
