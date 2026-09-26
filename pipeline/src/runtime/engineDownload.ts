// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  engineDownload.ts — how far the engine binary's download has got, as
 *        the boot bar reports it.
 */

/**
 * The bytes a download will count, or 0 when nothing honest can be said. The
 * stream yields decompressed bytes, so a compressing host's Content-Length is no
 * denominator (the bar ended its stage a third of the way through). The size the
 * export recorded is the answer when it is given.
 */
export function engineDownloadTotal(headers: Headers, engineBytes: number | undefined): number {
  if (engineBytes && engineBytes > 0) return engineBytes;
  const encoding = headers.get('content-encoding');
  if (encoding && encoding !== 'identity') return 0;
  return Number(headers.get('content-length') ?? 0);
}

/** The same bytes, with the fraction that has passed announced as they do. */
export function countedStream(
  body: ReadableStream<Uint8Array>, total: number, onFraction: (fraction: number) => void,
): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  let got = 0;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) {
        controller.close();
        return;
      }
      got += value.byteLength;
      onFraction(got / total);
      controller.enqueue(value);
    },
    cancel(reason) {
      void reader.cancel(reason);
    },
  });
}
