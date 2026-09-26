// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The boot bar's engine download, measured against what actually arrives.
 */
import { describe, it, expect } from 'vitest';
import { gzipSync } from 'node:zlib';
import { countedStream, engineDownloadTotal } from '../src/runtime/engineDownload';

/** A binary a host serves compressed, as a page's fetch sees it: decoded body,
 *  but the Content-Length of the compressed one. */
function compressedResponse(raw: Uint8Array): { res: Response; stated: number } {
    const gz = gzipSync(raw);
    const body = new Response(gz).body!.pipeThrough(new DecompressionStream('gzip'));
    return {
        res: new Response(body, { headers: { 'content-length': String(gz.length), 'content-encoding': 'gzip' } }),
        stated: gz.length,
    };
}

async function drain(stream: ReadableStream<Uint8Array>): Promise<void> {
    const r = stream.getReader();
    while (!(await r.read()).done) { /* read to the end */ }
}

const binary = (): Uint8Array => {
    const bytes = new Uint8Array(512 * 1024);
    for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 7) % 13;
    return bytes;
};

describe('the engine download a boot bar reports', () => {
    it('reaches its end with the last byte when the host compresses', async () => {
        const raw = binary();
        const { res, stated } = compressedResponse(raw);
        expect(stated).toBeLessThan(raw.length / 3);
        const seen: number[] = [];
        await drain(countedStream(res.body!, engineDownloadTotal(res.headers, raw.length), (f) => seen.push(f)));
        expect(seen.at(-1)).toBeCloseTo(1, 6);
        expect(seen.filter((f) => f >= 1)).toHaveLength(1);
    });

    it('does not divide decoded bytes by a compressed length', () => {
        const { res } = compressedResponse(binary());
        expect(engineDownloadTotal(res.headers, undefined)).toBe(0);
    });

    it('uses the stated length when nothing is compressed', () => {
        expect(engineDownloadTotal(new Headers({ 'content-length': '1000' }), undefined)).toBe(1000);
    });
});
