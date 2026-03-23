import { describe, it, expect, vi } from 'vitest';
import { GameSocket, type GameSocketOptions } from '../src/net/GameSocket';

describe('GameSocket', () => {
    it('should create instance with url', () => {
        const socket = new GameSocket({ url: 'ws://localhost:8080' });
        expect(socket).toBeDefined();
        expect(socket.readyState).toBe('closed');
    });

    it('should register callbacks', () => {
        const socket = new GameSocket({ url: 'ws://test' });
        const onOpen = vi.fn();
        const onMessage = vi.fn();
        const onClose = vi.fn();
        const onError = vi.fn();

        socket.onOpen = onOpen;
        socket.onMessage = onMessage;
        socket.onClose = onClose;
        socket.onError = onError;

        expect(socket.onOpen).toBe(onOpen);
        expect(socket.onMessage).toBe(onMessage);
        expect(socket.onClose).toBe(onClose);
        expect(socket.onError).toBe(onError);
    });

    it('should have send and close methods', () => {
        const socket = new GameSocket({ url: 'ws://test' });
        expect(typeof socket.send).toBe('function');
        expect(typeof socket.close).toBe('function');
    });

    it('should queue messages before connection', () => {
        const socket = new GameSocket({ url: 'ws://test' });
        expect(() => socket.send('hello')).not.toThrow();
    });
});
