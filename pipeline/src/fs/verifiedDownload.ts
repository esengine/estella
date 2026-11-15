// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { createWriteStream } from 'node:fs';

export interface VerifiedFile {
    bytes: number;
    sha256: string;
}

export async function saveVerified(
    stream: AsyncIterable<Uint8Array>,
    file: string,
    expected: VerifiedFile,
    onReceived?: (received: number) => void,
): Promise<string | null> {
    const digest = createHash('sha256');
    let received = 0;
    const sink = createWriteStream(file);
    for await (const chunk of stream) {
        digest.update(chunk);
        received += chunk.byteLength;
        onReceived?.(received);
        if (!sink.write(chunk)) await once(sink, 'drain');
    }
    await new Promise<void>((resolve, reject) => sink.end((err?: Error) => (err ? reject(err) : resolve())));

    if (received !== expected.bytes) return `download is ${received} bytes, the index says ${expected.bytes}`;
    const got = digest.digest('hex');
    if (got !== expected.sha256) {
        return `checksum mismatch — got ${got.slice(0, 16)}…, expected ${expected.sha256.slice(0, 16)}…`;
    }
    return null;
}
