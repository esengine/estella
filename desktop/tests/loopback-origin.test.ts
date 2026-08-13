// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The renderer's origin, which is where its preferences live.
 *
 * Served on an ephemeral port, the packaged editor got a new origin every launch
 * — and localStorage belongs to the origin, so the dock layout, the model beside
 * the composer and every other window preference came back to its default with
 * nothing said. A port that is asked for and given back is the whole fix.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import net from 'node:net';
import path from 'node:path';
import { loopbackServer, closeAllLoopbackServers } from '../electron/loopbackServer';

const roots: string[] = [];

const served = async (): Promise<string> => {
  const dir = await mkdtemp(path.join(tmpdir(), 'estella-loopback-'));
  await writeFile(path.join(dir, 'index.html'), '<!doctype html>');
  roots.push(dir);
  return dir;
};

const portOf = (url: string) => Number(new URL(url).port);

afterEach(async () => {
  closeAllLoopbackServers();
  for (const dir of roots.splice(0)) await rm(dir, { recursive: true, force: true });
});

describe('the origin the renderer is served on', () => {
  it('takes the port it is asked for, so the origin is the same one as last time', async () => {
    const first = await loopbackServer(await served());
    const port = portOf(first);
    closeAllLoopbackServers();

    const again = await loopbackServer(await served(), port);
    expect(portOf(again)).toBe(port);
  });

  it('falls back rather than failing when something else holds it', async () => {
    const squatter = net.createServer();
    await new Promise<void>((resolve) => squatter.listen(0, '127.0.0.1', resolve));
    const taken = (squatter.address() as net.AddressInfo).port;

    const url = await loopbackServer(await served(), taken);
    expect(portOf(url)).toBeGreaterThan(0);
    expect(portOf(url)).not.toBe(taken);
    await new Promise<void>((resolve) => squatter.close(() => resolve()));
  });

  it('still serves an ephemeral port to a caller that wants any', async () => {
    expect(portOf(await loopbackServer(await served()))).toBeGreaterThan(0);
  });
});
