// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  check-transport-contract.mjs — replication cannot be handed a link it
 *        cannot trust.
 *
 * The client applies its inbox in ARRIVAL order because that IS the authority's
 * order. That makes reliable, ordered delivery a correctness condition, not a
 * preference — and until `ReliableOrderedTransport` existed, the type system
 * would hand replication any `NetTransport` at all.
 *
 * A type rule nothing compiles is a comment. So this compiles two fixtures
 * against the SHIPPED declarations — what a user actually faces — and requires
 * one to pass and the other to be REFUSED, for the stated reason:
 *
 *   accept: every built-in transport, and a hand-written one that declares it
 *   reject: a transport that makes no delivery claim
 *
 * It does not try to defeat a deliberate `as ReliableOrderedTransport`. The job
 * of the contract is that correct code cannot wire this up wrong by accident.
 *
 *   node tools/check-transport-contract.mjs
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TSC = path.join(ROOT, 'sdk', 'node_modules', 'typescript', 'bin', 'tsc');
const DTS = path.join(ROOT, 'sdk', 'dist', 'index.d.ts');
const posix = (p) => p.split(path.sep).join('/');

const work = mkdtempSync(path.join(tmpdir(), 'estella-transport-'));

function fail(message, detail) {
  console.error(`check-transport-contract: ${message}`);
  if (detail) console.error(detail.trim());
  rmSync(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  process.exit(1);
}

if (!existsSync(DTS)) fail(`no SDK declarations at ${DTS} — build the SDK first.`);

/** Type-check one fixture on its own; returns tsc's combined output. */
function check(name, source) {
  const dir = path.join(work, name);
  const file = path.join(dir, 'fixture.ts');
  const config = path.join(dir, 'tsconfig.json');
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, source);
  writeFileSync(config, JSON.stringify({
    compilerOptions: {
      target: 'ES2022', module: 'ESNext', moduleResolution: 'bundler',
      strict: true, skipLibCheck: true, noEmit: true, types: [],
      lib: ['ES2022', 'DOM'],
      baseUrl: '.', paths: { esengine: [posix(DTS)] },
    },
    include: [posix(file)],
  }));
  const run = spawnSync(process.execPath, [TSC, '-p', config], { encoding: 'utf8', cwd: ROOT });
  return { status: run.status, out: `${run.stdout ?? ''}${run.stderr ?? ''}` };
}

// ---------------------------------------------------------------------------

const ACCEPT = `
import {
  MemoryTransport, GameSocket, createSocket,
  type ReliableOrderedTransport, type ReplicationServer, type NetSession,
} from 'esengine';

declare const server: ReplicationServer;
declare const session: NetSession;

// Built-ins: each already delivers this way and now says so.
const [a, b] = MemoryTransport.pair();
server.attachConnection(a);
void session.connect(b);
server.attachConnection(new GameSocket({ url: 'ws://127.0.0.1:1' }));
server.attachConnection(createSocket({ url: 'ws://127.0.0.1:1' }));

// A server author's own transport — the shape the dedicated-server example
// writes by hand around \`ws\`.
const mine: ReliableOrderedTransport = {
  delivery: 'reliable-ordered',
  send: () => {},
  on: () => () => {},
};
server.attachConnection(mine);
void session.connect(mine);
`;

/** One fixture per door: tsc reports a line, not a method, so guarding both
 *  has to be two compilations or the second one is unproven. */
const REJECT = (call) => `
import { type NetTransport, type ReplicationServer, type NetSession } from 'esengine';

declare const server: ReplicationServer;
declare const session: NetSession;

// Delivers frames, promises nothing about losing or reordering them.
const datagram: NetTransport = { send: () => {}, on: () => () => {} };

${call}
`;

const accepted = check('accept', ACCEPT);
if (accepted.status !== 0) {
  fail('a transport that DOES declare reliable-ordered delivery was rejected.', accepted.out);
}

const DOORS = {
  attachConnection: 'server.attachConnection(datagram);',
  connect: 'void session.connect(datagram);',
};
for (const [door, call] of Object.entries(DOORS)) {
  const rejected = check(`reject-${door}`, REJECT(call));
  if (rejected.status === 0) {
    fail(`\`${door}\` accepted a transport that makes no delivery claim.`
      + ' The inbox is applied in arrival order, so an unordered link desynchronizes it silently.');
  }
  if (!/delivery/.test(rejected.out)) {
    fail(`\`${door}\` refused it, but not for the missing delivery claim —`
      + ' the fixture may be failing on something else.', rejected.out);
  }
}

rmSync(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
console.log('check-transport-contract: replication takes reliable-ordered links only —'
  + ' built-ins and a hand-written one compile, an unclaimed transport is refused at both doors.');
