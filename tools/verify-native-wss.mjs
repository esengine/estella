// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { execFile, execFileSync, spawnSync } from 'node:child_process';
import { createHash, X509Certificate } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { toolArgs } from './lib/toolArgs.mjs';

const ARGS = toolArgs({ probe: null, trust: ['none', 'machine'] });
if (!ARGS.probe || !existsSync(ARGS.probe)) {
  console.error('verify-native-wss: --probe <path to the built ws_probe> is required and must exist.');
  process.exit(2);
}

const OPENSSL = ['openssl', 'C:\\Program Files\\Git\\usr\\bin\\openssl.exe', 'C:\\Program Files\\OpenSSL\\bin\\openssl.exe']
  .find((bin) => spawnSync(bin, ['version'], { stdio: 'ignore' }).status === 0);
if (!OPENSSL) {
  console.error('verify-native-wss: no openssl to make the test certificates with.');
  process.exit(2);
}

const scratch = mkdtempSync(path.join(tmpdir(), 'estella-wss-'));
const openssl = (...args) => execFileSync(OPENSSL, args, { cwd: scratch, stdio: ['ignore', 'ignore', 'pipe'] });

function authority(name) {
  writeFileSync(path.join(scratch, `${name}.cnf`), [
    '[req]', 'distinguished_name=dn', 'x509_extensions=v3', 'prompt=no',
    '[dn]', `CN=Estella wss test ${name}`,
    '[v3]', 'basicConstraints=critical,CA:TRUE', 'keyUsage=critical,keyCertSign,cRLSign', 'subjectKeyIdentifier=hash', '',
  ].join('\n'));
  openssl('req', '-x509', '-new', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-days', '2',
    '-keyout', `${name}.key`, '-out', `${name}.pem`, '-config', `${name}.cnf`);
  return path.join(scratch, `${name}.pem`);
}

function leaf(name, signer) {
  writeFileSync(path.join(scratch, `${name}.cnf`), ['[req]', 'distinguished_name=dn', 'prompt=no', '[dn]', 'CN=localhost', ''].join('\n'));
  writeFileSync(path.join(scratch, `${name}.ext`), [
    'basicConstraints=CA:FALSE', 'keyUsage=digitalSignature,keyEncipherment', 'extendedKeyUsage=serverAuth',
    'subjectAltName=DNS:localhost', '',
  ].join('\n'));
  openssl('req', '-new', '-newkey', 'rsa:2048', '-nodes', '-keyout', `${name}.key`, '-out', `${name}.csr`, '-config', `${name}.cnf`);
  openssl('x509', '-req', '-sha256', '-days', '2', '-in', `${name}.csr`, '-CA', `${signer}.pem`, '-CAkey', `${signer}.key`,
    '-CAcreateserial', '-out', `${name}.pem`, '-extfile', `${name}.ext`);
  return { key: readFileSync(path.join(scratch, `${name}.key`)), cert: readFileSync(path.join(scratch, `${name}.pem`)) };
}

const ACCEPT_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

function lengthBytes(length) {
  if (length < 126) return Buffer.from([length]);
  if (length <= 0xffff) return Buffer.from([126, length >> 8, length & 0xff]);
  const wide = Buffer.alloc(9);
  wide[0] = 127;
  wide.writeBigUInt64BE(BigInt(length), 1);
  return wide;
}

function echo(server) {
  server.on('upgrade', (req, socket) => {
    const accept = createHash('sha1').update(req.headers['sec-websocket-key'] + ACCEPT_GUID).digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    const frame = (opcode, payload) => socket.write(Buffer.concat([Buffer.from([0x80 | opcode]), lengthBytes(payload.length), payload]));
    let pending = Buffer.alloc(0);
    socket.on('data', (chunk) => {
      pending = Buffer.concat([pending, chunk]);
      for (;;) {
        if (pending.length < 2) return;
        const opcode = pending[0] & 0x0f;
        let length = pending[1] & 0x7f, at = 2;
        if (length === 126) { if (pending.length < 4) return; length = pending.readUInt16BE(2); at = 4; }
        else if (length === 127) { if (pending.length < 10) return; length = Number(pending.readBigUInt64BE(2)); at = 10; }
        if (pending.length < at + 4 + length) return;
        const mask = pending.subarray(at, at + 4);
        const payload = Buffer.from(pending.subarray(at + 4, at + 4 + length));
        for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
        pending = pending.subarray(at + 4 + length);
        if (opcode === 0x8) { frame(0x8, payload.subarray(0, 2)); socket.end(); return; }
        if (opcode === 0x9) frame(0xa, payload);
        else if (opcode === 0x1 || opcode === 0x2) frame(opcode, payload);
      }
    });
    socket.on('error', () => {});
  });
  server.on('tlsClientError', () => {});
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

function probe(url) {
  return new Promise((resolve) => {
    execFile(ARGS.probe, [url, '20'], { encoding: 'utf8', timeout: 40000 }, (err, stdout, stderr) => {
      try {
        resolve(JSON.parse(stdout.trim().split('\n').pop()));
      } catch {
        resolve({ crashed: true, code: err?.code ?? null, signal: err?.signal ?? null, stdout, stderr });
      }
    });
  });
}

const trusted = authority('authority');
authority('stranger');
const known = leaf('known', 'authority');
const unknown = leaf('unknown', 'stranger');
const thumbprint = new X509Certificate(readFileSync(trusted)).fingerprint.replaceAll(':', '');

const placed = [];
function trust() {
  if (ARGS.trust !== 'machine') return;
  if (process.platform === 'win32') {
    execFileSync('certutil', ['-addstore', 'Root', trusted], { stdio: 'ignore' });
    placed.push(() => spawnSync('certutil', ['-delstore', 'Root', thumbprint], { stdio: 'ignore' }));
  } else if (process.platform === 'darwin') {
    const keychain = '/Library/Keychains/System.keychain';
    execFileSync('sudo', ['-n', 'security', 'add-trusted-cert', '-d', '-r', 'trustRoot', '-k', keychain, trusted], { stdio: 'ignore' });
    placed.push(() => spawnSync('sudo', ['-n', 'security', 'delete-certificate', '-Z', thumbprint, keychain], { stdio: 'ignore' }));
  } else {
    const installed = '/usr/local/share/ca-certificates/estella-wss-test.crt';
    execFileSync('sudo', ['-n', 'cp', trusted, installed], { stdio: 'ignore' });
    execFileSync('sudo', ['-n', 'update-ca-certificates'], { stdio: 'ignore' });
    placed.push(() => {
      spawnSync('sudo', ['-n', 'rm', '-f', installed], { stdio: 'ignore' });
      spawnSync('sudo', ['-n', 'update-ca-certificates', '--fresh'], { stdio: 'ignore' });
    });
  }
}

const servers = [];
let failed = 0;
function judge(name, got, want) {
  const ok = Object.entries(want).every(([key, value]) => (typeof value === 'function' ? value(got[key]) : got[key] === value));
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : ` — ${JSON.stringify(got)}`}`);
  if (!ok) failed++;
}

try {
  trust();
  const plain = await echo(http.createServer());
  const modern = await echo(https.createServer({ ...known }));
  const older = await echo(https.createServer({ ...known, maxVersion: 'TLSv1.2' }));
  const stranger = await echo(https.createServer({ ...unknown }));
  servers.push(plain, modern, older, stranger);
  const port = (server) => server.address().port;
  const whole = { opened: true, text: true, binary: true, closed: true };
  const refused = { opened: false, closed: true, code: 1006, error: (text) => typeof text === 'string' && text.length > 0 };

  judge('ws:// still opens, echoes text and 70,000 bytes, and closes', await probe(`ws://127.0.0.1:${port(plain)}/echo`), whole);
  judge('wss:// to a certificate no authority here signed is refused', await probe(`wss://localhost:${port(stranger)}/echo`), refused);
  if (ARGS.trust === 'none') {
    console.log('– three cases need the test authority trusted and did not run: --trust machine adds it to this machine\'s trust store and takes it out again');
  } else {
    judge('wss:// to a trusted certificate opens, echoes and closes', await probe(`wss://localhost:${port(modern)}/echo`), whole);
    judge('wss:// to a server that stops at TLS 1.2 does the same', await probe(`wss://localhost:${port(older)}/echo`), whole);
    judge('wss:// to a trusted certificate under a name it does not carry is refused', await probe(`wss://127.0.0.1:${port(modern)}/echo`), refused);
  }
} finally {
  for (const server of servers) server.close();
  for (const undo of placed) undo();
  rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
}

if (failed > 0) {
  console.error(`verify-native-wss: ${failed} case(s) failed.`);
  process.exit(1);
}
console.log('verify-native-wss: the native socket speaks ws:// and wss://, and refuses a certificate it cannot trust.');
process.exit(0);
