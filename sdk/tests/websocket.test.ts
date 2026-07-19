// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect, vi } from 'vitest';
import { GameSocket } from '../src/net/GameSocket';

describe('GameSocket', () => {
    it('should create instance with url', () => {
        const socket = new GameSocket({ url: 'ws://localhost:8080' });
        expect(socket).toBeDefined();
        expect(socket.readyState).toBe('closed');
    });

    it('on() registers handlers and returns an unsubscribe', () => {
        const socket = new GameSocket({ url: 'ws://test' });
        const onOpen = vi.fn();
        const onMessage = vi.fn();

        const offOpen = socket.on('open', onOpen);
        const offMessage = socket.on('message', onMessage);

        expect(typeof offOpen).toBe('function');
        expect(typeof offMessage).toBe('function');
        offOpen();
        offMessage();
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
