// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  What a spawn payload actually carries, and under which contract.
 *
 * `spawnPayload_` builds its payload with `serializeEntityComponents` — the
 * SCENE projection, which answers "how is this entity restored in full". A wire
 * projection answers a different question: "which facts is this client
 * authorized and declared to know". The two have been the same code, so every
 * non-transient component a server happens to hang on a replicated entity has
 * been transiting, whether or not it declares a single replicated field.
 *
 * This does not measure anything. It takes real spawn payloads off the wire and
 * sorts their components into the contracts they would belong to, so the
 * construction recipe that is currently implicit can be read.
 *
 *   node bench/spawn-contract/probe.mjs
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PROJECT = path.join(ROOT, 'examples', 'multiplayer-arena');
const SDK = path.join(ROOT, 'sdk', 'dist', 'index.node.js');
const WASM = process.env.ESENGINE_WASM_DIR ?? path.join(ROOT, 'build', 'wasm', 'web');
const posix = (p) => p.split(path.sep).join('/');
const work = mkdtempSync(path.join(tmpdir(), 'estella-spawn-'));

/**
 * The certified example's own gameplay, bundled against the same SDK instance:
 * two component registries would make the handshake reject the server's own
 * client, and a transcription of the pawn would be a probe of this file rather
 * than of the game.
 */
writeFileSync(path.join(work, 'entry.ts'), `
export * from 'esengine';
import ${JSON.stringify(posix(path.join(PROJECT, 'src', 'main.ts')))};
`);
const out = path.join(work, 'bundle.mjs');
const { build } = await import('esbuild');
await build({
    entryPoints: [path.join(work, 'entry.ts')],
    outfile: out, bundle: true, format: 'esm', platform: 'node', target: 'node20',
    logLevel: 'silent', alias: { esengine: SDK, 'esengine/node': SDK },
});
const sdk = await import(pathToFileURL(out).href);

const factory = (await import(pathToFileURL(path.join(WASM, 'esengine.js')).href)).default;
const engine = await factory({ locateFile: (f) => path.join(WASM, f) });

const serverApp = sdk.App.new();
serverApp.connectCpp(new engine.Registry(), engine, { strict: false });
serverApp.addPlugin(sdk.replicationPlugin);
sdk.flushPendingRegistrations(serverApp);
serverApp.getResource(sdk.Net).startServer();

const clientApp = sdk.App.new();
clientApp.connectCpp(new engine.Registry(), engine, { strict: false });
clientApp.addPlugin(sdk.replicationPlugin);
const [ta, tb] = sdk.MemoryTransport.pair();

/** Every spawn the authority actually put on the wire. */
const spawned = [];
const send = ta.send.bind(ta);
ta.send = (d) => {
    if (typeof d === 'string' && d.includes('repl:spawn')) {
        try {
            const msg = JSON.parse(d);
            for (const e of msg?.d?.entities ?? []) spawned.push(e);
        } catch { /* not ours */ }
    }
    send(d);
};
serverApp.getResource(sdk.Net).server.attachConnection(ta);
await clientApp.getResource(sdk.Net).connect(tb, { interpolationDelayTicks: 0 });

const STEP = 1 / 60;
for (let i = 0; i < 20; i++) { await serverApp.tick(STEP); await clientApp.tick(STEP); }
if (process.env.SPAWN_DEBUG) {
    const net = serverApp.getResource(sdk.Net);
    process.stderr.write(`role=${net.role} clients=${JSON.stringify(net.server?.clientIds ?? [])} ` +
        `pawns=${serverApp.world.getEntitiesWithComponents([sdk.Replicated]).length}
`);
}

if (spawned.length === 0) {
    process.stderr.write('no spawn reached the wire — the arena provisioned nothing to classify\n');
    rmSync(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    process.exit(1);
}

/** The three contracts a payload component could belong to. */
const PROTOCOL = new Set(['Replicated']);
const rows = [];
for (const s of spawned) {
    for (const c of s.components) {
        const declared = sdk.getReplicatedFields(c.type) ?? [];
        rows.push({
            entity: s.name || `netId ${s.netId}`,
            component: c.type,
            contract: declared.length > 0 ? 'replication table'
                : PROTOCOL.has(c.type) ? 'protocol metadata'
                    : 'undeclared — construction or leak',
            declaredFields: [...declared],
            sentFields: Object.keys(c.data ?? {}),
        });
    }
}

const byContract = {};
for (const r of rows) (byContract[r.contract] ??= []).push(r);
/** Fields a table component sent BEYOND what it declares: the same hole, per field. */
const overSent = rows.filter((r) => r.contract === 'replication table'
    && r.sentFields.some((f) => !r.declaredFields.includes(f)));

process.stdout.write(`${JSON.stringify({
    source: 'examples/multiplayer-arena',
    spawns: spawned.length,
    payloadComponents: rows.length,
    byContract: Object.fromEntries(Object.entries(byContract).map(([k, v]) => [k, v.length])),
    rows,
    componentsSentBeyondTheirDeclaration: overSent.map((r) => ({
        component: r.component,
        declared: r.declaredFields,
        sent: r.sentFields,
    })),
}, null, 2)}\n`);
rmSync(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
