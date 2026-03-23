export { GameSocket, type GameSocketOptions, type SocketReadyState } from './GameSocket';
export { WeChatSocket } from './WeChatSocket';

import { GameSocket, type GameSocketOptions } from './GameSocket';
import { WeChatSocket } from './WeChatSocket';

export function createSocket(options: GameSocketOptions): GameSocket | WeChatSocket {
    const g = globalThis as any;
    if (typeof g.wx !== 'undefined' && typeof g.wx.connectSocket === 'function') {
        return new WeChatSocket(options);
    }
    return new GameSocket(options);
}
