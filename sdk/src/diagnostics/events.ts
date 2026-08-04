// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    events.ts
 * @brief   What a shipped game reports about going wrong, and why it is
 *          AGGREGATED before anyone sees it.
 *
 * The failures that matter in a released game are the ones nobody is watching:
 * a device that loses its GL context, an asset that 404s for players in one
 * region, a system that throws on frame 12,000. None of them reach the person
 * who could fix them, because the console they would print to is on a phone.
 *
 * The reason this is not simply "send every error somewhere" is the shape those
 * errors have. A system that throws does it EVERY FRAME — sixty identical
 * reports a second, from every player at once. Sent one by one that is not
 * telemetry, it is an outage the engine caused: the network queue grows without
 * bound, the sink's rate limit trips, and the one distinct error that would have
 * explained everything arrives after the flood, if at all.
 *
 * So the unit here is not the error, it is the DISTINCT error with a count. Two
 * throws from the same system with the same message are one event seen twice,
 * carrying `firstAt`/`lastAt`, and the report says "1,842 times over 31s" —
 * which is more diagnostic than 1,842 copies would be, and is the difference
 * between a feature that can be left on in production and one that cannot.
 *
 * Nothing in this file talks to a network. See `Diagnostics.ts` for why the
 * engine never picks a destination.
 */

/** Where an event came from. Not a severity — every kind here is something the
 *  game did not intend, and what differs is who can act on it. */
export type DiagnosticKind =
    /**
     * Anything the engine logged as an error: a system that threw during a
     * schedule, an asset that would not load, a subsystem that refused to start.
     *
     * One kind rather than several, because the split a developer acts on is
     * carried by `source` (the log category, or the system's name) — and the
     * alternative was recognizing a system throw by pattern-matching the
     * sentence the logger happened to print, which would break the first time
     * anyone rephrased it.
     */
    | 'engine'
    /** Reached the host with nobody catching it: `window.onerror`,
     *  `unhandledrejection`, `wx.onError`. Usually game code outside a system —
     *  a callback, a promise, a timer. */
    | 'unhandled'
    /** The GPU took the context away (backgrounded, driver reset, too many
     *  contexts). The frame after this one draws nothing. */
    | 'context-lost'
    /** The OS says memory is running out. Not yet a failure — it is the warning
     *  that arrives before the process is killed, which is the crash no report
     *  ever gets sent for. */
    | 'memory'
    /** The game itself called `Diagnostics.report` — a failed purchase, a save
     *  that would not write, whatever it considers worth knowing. */
    | 'game';

/** One distinct problem, however many times it happened. */
export interface DiagnosticEvent {
    kind: DiagnosticKind;
    /** Stable identity across repeats — see {@link fingerprint}. */
    id: string;
    message: string;
    /** The engine subsystem or the system's name, when there is one. */
    source?: string;
    stack?: string;
    /** How many times this exact problem has occurred since it was first seen. */
    count: number;
    /** Epoch ms of the first and most recent occurrence. */
    firstAt: number;
    lastAt: number;
    /** Whatever the reporter attached. The engine never puts anything
     *  identifying here, and neither should a game — see the file header of
     *  `Diagnostics.ts`. */
    context?: Record<string, unknown>;
}

/** A problem as it is reported, before aggregation gives it a count. */
export interface DiagnosticReport {
    kind: DiagnosticKind;
    message: string;
    source?: string;
    /** An Error, or anything thrown — the stack is taken from it when there is
     *  one. Strings and non-Errors are tolerated: `throw 'nope'` is legal JS and
     *  is exactly the kind of code that ships. */
    error?: unknown;
    context?: Record<string, unknown>;
}

/** The stack of anything that was thrown, including the cross-realm case: an
 *  Error from a WeChat sub-context or an iframe fails `instanceof` but still
 *  carries `stack` (the same reason the console log handler checks for it). */
export function stackOf(error: unknown): string | undefined {
    if (!error || typeof error !== 'object') return undefined;
    const stack = (error as { stack?: unknown }).stack;
    return typeof stack === 'string' ? stack : undefined;
}

export function messageOf(error: unknown): string {
    if (typeof error === 'string') return error;
    if (error && typeof error === 'object') {
        const message = (error as { message?: unknown }).message;
        if (typeof message === 'string') return message;
    }
    return String(error);
}

/**
 * The identity two occurrences of the same problem share.
 *
 * Message + source + the first stack frame. The message alone would merge two
 * unrelated "Cannot read properties of undefined" into one event and hide a
 * second bug behind the first; the WHOLE stack would split one bug into a dozen
 * events whenever it is reached through different callers, which is the failure
 * that makes a crash reporter useless at exactly the moment it is needed.
 *
 * Numbers in the message are normalized away, because an error carrying an
 * entity id or a frame count would otherwise be a brand-new problem every time
 * it happened.
 */
export function fingerprint(report: DiagnosticReport): string {
    const frame = firstFrame(stackOf(report.error));
    return [report.kind, report.source ?? '', normalize(report.message), frame].join('|');
}

const normalize = (message: string): string =>
    message.replace(/\b\d[\d.]*\b/g, '#').replace(/\s+/g, ' ').trim().slice(0, 200);

function firstFrame(stack: string | undefined): string {
    if (!stack) return '';
    for (const line of stack.split('\n')) {
        const trimmed = line.trim();
        // Skip the header ("Error: message") — V8 puts it first, other engines
        // do not, so it is recognized rather than counted past.
        if (!trimmed || (!trimmed.startsWith('at ') && !trimmed.includes('@'))) continue;
        return trimmed.slice(0, 200);
    }
    return '';
}
