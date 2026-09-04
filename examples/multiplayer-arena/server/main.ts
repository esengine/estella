// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The dedicated server for this arena — the same game, no window.
 *
 * The editor's "2 Players (Listen Server)" preview runs the authority inside a
 * player's own process over in-memory ports. That is the right shape for
 * developing, and the wrong shape for shipping: it needs somebody's game to be
 * running, and it never exercises a connection that DROPS.
 *
 * This entry is the shipping shape. It boots the same engine wasm with no
 * renderer (`createHeadlessApp`), installs the project's own systems through
 * the same door the shipped web runtime uses (`flushPendingRegistrations`), and
 * accepts real WebSocket clients. Not one line of `src/` is server-specific —
 * the only thing this process says about itself is `arena.hostPlays = false`,
 * because there is nobody at a keyboard here.
 *
 *   node server/run.mjs --port 8080
 *
 * A browser client then connects to `ws://<host>:8080` instead of being handed
 * a MessagePort. See the README's "Dedicated server" section.
 */
import { WebSocketServer, type WebSocket } from 'ws';
import {
    loadEsengineModule, createHeadlessApp, runHeadless,
    flushPendingRegistrations, Net, type ReliableOrderedTransport,
} from 'esengine/node';
import { arena } from '../src/net';
// Side-effect import: `src/main.ts` registers the arena's systems at module
// scope, exactly as it does in the browser. The server runs the project's real
// entry point rather than a reimplementation of it.
import '../src/main';

interface ServerOptions {
    port: number;
    host: string;
    /** Directory holding the web engine build (esengine.js + esengine.wasm). */
    wasm: string;
    /** Simulation rate. The replication cadence follows the fixed timestep. */
    fps: number;
}

/**
 * One accepted `ws` connection, as the transport replication asks for: send a
 * frame, subscribe to frames, and a claim that the link loses and reorders
 * nothing. A WebSocket does neither, so the claim is honest here; a transport
 * that cannot make it is refused at compile time rather than desynchronizing.
 */
function wsTransport(socket: WebSocket): ReliableOrderedTransport {
    const handlers = new Set<(data: string | ArrayBuffer) => void>();
    socket.on('message', (data: Buffer | ArrayBuffer | Buffer[], isBinary: boolean) => {
        // Binary frames are the delta stream and must reach the channel as an
        // ArrayBuffer; `ws` hands over a Buffer that is usually a VIEW into a
        // larger pooled allocation, so the byte range has to be sliced out.
        const frame = isBinary ? toArrayBuffer(data) : String(data);
        for (const handler of [...handlers]) handler(frame);
    });
    return {
        delivery: 'reliable-ordered',
        send: (data) => socket.send(data),
        on: (_event, handler) => {
            handlers.add(handler);
            return () => handlers.delete(handler);
        },
    };
}

function toArrayBuffer(data: Buffer | ArrayBuffer | Buffer[]): ArrayBuffer {
    if (data instanceof ArrayBuffer) return data;
    const buf = Array.isArray(data) ? Buffer.concat(data) : data;
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

export async function startArenaServer(options: ServerOptions): Promise<() => Promise<void>> {
    // No keyboard on this machine, so no pawn for player 0 — the one line that
    // separates a dedicated server from the editor's listen server.
    arena.hostPlays = false;

    const engineModule = await loadEsengineModule(options.wasm);
    const app = createHeadlessApp(engineModule);
    // Install what `src/main.ts` registered at import time. Before the loop
    // starts, so the authority's first tick already runs the arena's systems.
    flushPendingRegistrations(app);

    const server = app.getResource(Net).startServer();

    const wss = new WebSocketServer({ port: options.port, host: options.host });
    await new Promise<void>((resolve, reject) => {
        wss.once('listening', resolve);
        wss.once('error', reject);
    });

    wss.on('connection', (socket: WebSocket) => {
        const id = server.attachConnection(wsTransport(socket));
        console.log(`[arena] connection ${id} attached`);
        // Detaching is what makes the roster shrink: `clientIds` drops this id,
        // and ProvisionPawnsSystem retires the pawn on its next fixed tick.
        // Without it the arena fills up with pawns nobody is steering.
        const drop = () => {
            server.detachConnection(id);
            console.log(`[arena] connection ${id} dropped`);
        };
        socket.on('close', drop);
        socket.on('error', drop);
    });

    const stopLoop = runHeadless(app, { fps: options.fps });
    const address = wss.address();
    const port = typeof address === 'object' && address ? address.port : options.port;
    console.log(`[arena] listening on ws://${options.host}:${port} (${options.fps} Hz)`);

    return async () => {
        stopLoop();
        await new Promise<void>((resolve) => wss.close(() => resolve()));
    };
}

// ---------------------------------------------------------------------------
// Command line. `--port 0` asks the OS for a free port and prints the one it
// got, which is how the repo's gate runs this without picking a fixed number.
// ---------------------------------------------------------------------------

function arg(name: string, fallback: string): string {
    const i = process.argv.indexOf(`--${name}`);
    return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const stop = await startArenaServer({
    port: Number(arg('port', '8080')),
    host: arg('host', '127.0.0.1'),
    wasm: arg('wasm', 'wasm'),
    fps: Number(arg('fps', '60')),
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => { void stop().then(() => process.exit(0)); });
}
