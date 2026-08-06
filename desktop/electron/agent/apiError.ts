// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    apiError.ts
 * @brief   What went wrong, said to the person who has to decide what to do
 *          about it.
 *
 * An SDK's own message is written for whoever is reading a stack trace — it
 * names a status code and a URL. In the transcript the only useful content is
 * which of four situations this is, because each has a different answer: wait,
 * fix the key, check the address, or nothing (it already retried).
 *
 * Shared by every provider because it is about HTTP, not about a wire format —
 * both SDKs raise the same statuses with the same meanings, and a second copy
 * would be a second set of sentences to keep in step with the settings page they
 * point at.
 */

/** An SDK hands back a `Headers` on some paths and a plain object on others;
 *  reading only one shape is how the useful half of a 429 goes missing. */
function headerOf(error: unknown, name: string): string | undefined {
  const headers = (error as { headers?: unknown })?.headers;
  if (!headers) return undefined;
  const get = (headers as Headers).get;
  if (typeof get === 'function') return (headers as Headers).get(name) ?? undefined;
  return (headers as Record<string, string>)[name];
}

/**
 * Whether asking again could plausibly work: the failure was the CONNECTION or
 * the far side, not the request.
 *
 * A stream that dies halfway is the common one, and it is not rare over a long
 * turn — a dogfood run lost eighty-seven rounds of work to a socket the gateway
 * closed. It arrives with no HTTP status at all, because the request had already
 * succeeded and the body stopped arriving.
 */
export function isTransientApiError(error: unknown): boolean {
  const status = (error as { status?: number })?.status;
  if (status === undefined || status === null) return true;
  return status === 408 || status === 429 || status >= 500;
}

export function describeApiError(error: unknown): string {
  const status = (error as { status?: number })?.status;
  const raw = (error as Error)?.message ?? String(error);
  const retryAfter = Number(headerOf(error, 'retry-after'));

  if (status === 429) {
    // The SDK has already retried this with backoff by the time it reaches us,
    // so "try again" is not advice — how long to wait is.
    return Number.isFinite(retryAfter) && retryAfter > 0
      ? `Rate limited, and the automatic retries did not clear it. The endpoint asks for ${retryAfter}s.`
      : 'Rate limited, and the automatic retries did not clear it. Wait a moment and send again.';
  }
  if (status === 401 || status === 403) {
    return 'The endpoint rejected the API key. Check it in Settings › AI Agents.';
  }
  if (status === 404) {
    return 'The endpoint has no such model, or the address is wrong. Check both in Settings › AI Agents.';
  }
  if (status === 400) return `The endpoint refused the request: ${raw}`;
  if (status && status >= 500) return 'The endpoint is having trouble. Nothing is wrong on this side — try again shortly.';
  // Not an HTTP failure at all: DNS, offline, a gateway that is not running.
  if (!status) return `Could not reach the endpoint: ${raw}`;
  return raw;
}
