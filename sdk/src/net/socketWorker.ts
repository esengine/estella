// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    socketWorker.ts
 * @brief   A game server's sockets on a thread of their own (Node only).
 *
 *          Measured on a 400-player replication server, a third of the main
 *          thread went to writing to sockets — one system call per client per
 *          tick, plus WebSocket framing — on the thread the simulation needs.
 *          Here a worker thread owns the listener and every socket: the main
 *          thread queues what it sends and hands the whole tick's worth over
 *          in one message; the worker writes each client's frames in one
 *          write and passes back what clients sent, also in batches.
 *
 *          Each connection reaches the main thread as an ordinary
 *          {@link ReliableOrderedTransport}, so `server.attachConnection` takes
 *          it unchanged. The worker needs the `ws` package where the server
 *          runs, as `webSocketTransport` does.
 */
import type { ReliableOrderedTransport } from './NetChannel';

export interface SocketWorkerOptions {
    port: number;
    /** Default `0.0.0.0`. */
    host?: string;
    /** Only upgrades to this path are taken. Default any. */
    path?: string;
    /** A client this far behind on reading is closed (1013) rather than buffered for. Default 4 MiB. */
    maxBufferedBytes?: number;
    /**
     * Where the `ws` package is, for the worker to load. Default: resolved from
     * the working directory, then from this module.
     */
    wsPath?: string;
}

/** One client's socket, as the main thread sees it. */
export interface WorkerSocketTransport extends ReliableOrderedTransport {
    /** The client's address, as the worker's socket saw it. */
    readonly remoteAddress: string;
    /** Called once when the socket is gone, from either side. Returns an unsubscribe. */
    onClose(handler: (code: number) => void): () => void;
}

export interface SocketWorker {
    /** The port the worker listens on (the one asked for, or the one given for 0). */
    readonly port: number;
    /** Hear each new connection. Returns an unsubscribe. */
    onConnection(handler: (transport: WorkerSocketTransport) => void): () => void;
    /** Close every socket and the listener, and end the worker. */
    close(): Promise<void>;
}

/** Main thread to worker: one tick's frames, a close. */
type ToWorker =
    | { t: 'send'; batch: [number, string | ArrayBuffer][] }
    | { t: 'close'; id: number; code?: number; reason?: string }
    | { t: 'stop' };

/** Worker to main thread: the listener up, a new socket, what clients sent, a socket gone. */
type FromWorker =
    | { t: 'listening'; port: number }
    | { t: 'error'; message: string }
    | { t: 'open'; id: number; address: string }
    | { t: 'recv'; batch: [number, string | ArrayBuffer][] }
    | { t: 'closed'; id: number; code: number }
    | { t: 'stopped' };

/** The worker's program. Plain JavaScript, run with `eval`, so it needs no file of its own. */
const WORKER_SOURCE = String.raw`
const { parentPort, workerData } = require('node:worker_threads');
const { WebSocketServer } = require(workerData.wsPath);
const sockets = new Map();
let nextId = 1;
let inbound = [];
let scheduled = false;
const flushIn = () => {
    scheduled = false;
    if (inbound.length === 0) return;
    const batch = inbound;
    inbound = [];
    parentPort.postMessage({ t: 'recv', batch });
};
const wss = new WebSocketServer({
    port: workerData.port, host: workerData.host, perMessageDeflate: false,
    ...(workerData.path ? { path: workerData.path } : {}),
});
wss.on('listening', () => parentPort.postMessage({ t: 'listening', port: wss.address().port }));
wss.on('error', (err) => parentPort.postMessage({ t: 'error', message: String(err && err.message || err) }));
wss.on('connection', (socket, req) => {
    const id = nextId++;
    sockets.set(id, socket);
    parentPort.postMessage({ t: 'open', id, address: (req && req.socket && req.socket.remoteAddress) || '' });
    socket.on('message', (data, isBinary) => {
        let frame;
        if (isBinary) {
            const buf = Array.isArray(data) ? Buffer.concat(data) : Buffer.isBuffer(data) ? data : Buffer.from(data);
            frame = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
        } else {
            frame = String(data);
        }
        inbound.push([id, frame]);
        if (!scheduled) { scheduled = true; setImmediate(flushIn); }
    });
    let gone = false;
    const end = (code) => {
        if (gone) return;
        gone = true;
        sockets.delete(id);
        flushIn();
        parentPort.postMessage({ t: 'closed', id, code });
    };
    socket.on('close', (code) => end(code));
    socket.on('error', () => end(1006));
});
parentPort.on('message', (m) => {
    if (m.t === 'send') {
        // One client's frames of this batch go out in one write.
        const per = new Map();
        for (const [id, data] of m.batch) {
            let list = per.get(id);
            if (!list) { list = []; per.set(id, list); }
            list.push(data);
        }
        for (const [id, list] of per) {
            const socket = sockets.get(id);
            if (!socket) continue;
            if (workerData.maxBuffered > 0 && socket.bufferedAmount > workerData.maxBuffered) {
                socket.close(1013, 'client too slow');
                continue;
            }
            const raw = socket._socket;
            if (raw && raw.cork) raw.cork();
            for (const data of list) socket.send(data);
            if (raw && raw.uncork) raw.uncork();
        }
    } else if (m.t === 'close') {
        const socket = sockets.get(m.id);
        if (socket) socket.close(m.code, m.reason);
    } else if (m.t === 'stop') {
        for (const s of sockets.values()) s.terminate();
        wss.close(() => parentPort.postMessage({ t: 'stopped' }));
    }
});
`;

async function resolveWs(explicit: string | undefined): Promise<string> {
    if (explicit) return explicit;
    const { createRequire } = await import('node:module');
    const proc = (globalThis as { process?: { cwd(): string } }).process;
    const bases = [`${proc?.cwd() ?? '.'}/`, import.meta.url];
    for (const base of bases) {
        try { return createRequire(base).resolve('ws'); } catch { /* next */ }
    }
    throw new Error('[net] the socket worker needs the "ws" package: install it, or pass wsPath');
}

/**
 * Listen for WebSocket clients on a worker thread. Resolves once the worker
 * is listening.
 */
export async function startSocketWorker(options: SocketWorkerOptions): Promise<SocketWorker> {
    const { Worker } = await import('node:worker_threads');
    const wsPath = await resolveWs(options.wsPath);
    const worker = new Worker(WORKER_SOURCE, {
        eval: true,
        workerData: {
            port: options.port, host: options.host ?? '0.0.0.0', path: options.path,
            maxBuffered: options.maxBufferedBytes ?? 4 * 1024 * 1024, wsPath,
        },
    });

    interface Conn {
        handlers: Set<(data: string | ArrayBuffer) => void>;
        closeHandlers: Set<(code: number) => void>;
        open: boolean;
    }
    const conns = new Map<number, Conn>();
    const connectionHandlers = new Set<(t: WorkerSocketTransport) => void>();

    // Everything sent in this turn of the event loop goes to the worker as one message.
    let outbound: [number, string | ArrayBuffer][] = [];
    let flushQueued = false;
    const flushOut = (): void => {
        flushQueued = false;
        if (outbound.length === 0) return;
        const batch = outbound;
        outbound = [];
        worker.postMessage({ t: 'send', batch } satisfies ToWorker);
    };
    const queue = (id: number, data: string | ArrayBuffer): void => {
        outbound.push([id, data]);
        if (!flushQueued) { flushQueued = true; queueMicrotask(flushOut); }
    };

    const closed = (id: number, code: number): void => {
        const c = conns.get(id);
        if (!c || !c.open) return;
        c.open = false;
        conns.delete(id);
        for (const h of [...c.closeHandlers]) { try { h(code); } catch { /* one does not stop the rest */ } }
    };

    let port = 0;
    let stoppedResolve: (() => void) | null = null;
    const listening = new Promise<void>((resolve, reject) => {
        worker.on('message', (m: FromWorker) => {
            switch (m.t) {
                case 'listening': port = m.port; resolve(); break;
                case 'error': reject(new Error(`[net] socket worker: ${m.message}`)); break;
                case 'open': {
                    const conn: Conn = { handlers: new Set(), closeHandlers: new Set(), open: true };
                    conns.set(m.id, conn);
                    const id = m.id;
                    const transport: WorkerSocketTransport = {
                        delivery: 'reliable-ordered',
                        remoteAddress: m.address,
                        send: (data) => {
                            if (!conn.open) throw new Error('[net] socket closed');
                            queue(id, data);
                        },
                        on: (_event, handler) => { conn.handlers.add(handler); return () => conn.handlers.delete(handler); },
                        close: (code, reason) => {
                            if (!conn.open) return;
                            flushOut();
                            worker.postMessage({ t: 'close', id, code, reason } satisfies ToWorker);
                        },
                        onClose: (handler) => {
                            if (!conn.open) { queueMicrotask(() => handler(1006)); return () => undefined; }
                            conn.closeHandlers.add(handler);
                            return () => conn.closeHandlers.delete(handler);
                        },
                    };
                    for (const h of [...connectionHandlers]) h(transport);
                    break;
                }
                case 'recv':
                    for (const [id, data] of m.batch) {
                        const c = conns.get(id);
                        if (!c) continue;
                        for (const h of [...c.handlers]) h(data);
                    }
                    break;
                case 'closed': closed(m.id, m.code); break;
                case 'stopped': stoppedResolve?.(); break;
            }
        });
        worker.on('error', reject);
    });
    await listening;

    return {
        get port() { return port; },
        onConnection(handler) {
            connectionHandlers.add(handler);
            return () => { connectionHandlers.delete(handler); };
        },
        async close() {
            flushOut();
            await new Promise<void>((resolve) => {
                stoppedResolve = resolve;
                worker.postMessage({ t: 'stop' } satisfies ToWorker);
                setTimeout(resolve, 2000);
            });
            for (const id of [...conns.keys()]) closed(id, 1001);
            await worker.terminate();
        },
    };
}
