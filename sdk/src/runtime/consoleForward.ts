// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    consoleForward.ts
 * @brief   Everything a game prints, handed to a listener as well as the console.
 *
 * wasm print/printErr and the SDK logger both route through console, so wrapping
 * it catches the whole stream — the editor's Play realm and a development build
 * talking to the editor forward the same lines.
 */
export type ConsoleLevel = 'info' | 'warn' | 'error';

const LEVELS = { log: 'info', info: 'info', debug: 'info', warn: 'warn', error: 'error' } as const;

export function formatConsoleArg(a: unknown): string {
    if (typeof a === 'string') return a;
    if (a instanceof Error) return a.stack ?? a.message;
    try {
        return typeof a === 'object' ? JSON.stringify(a) : String(a);
    } catch {
        return String(a);
    }
}

/** Wrap console so @p send hears every line; returns the unwrap. A throwing
 *  listener never stops the original console from printing. */
export function forwardConsole(send: (level: ConsoleLevel, line: string) => void): () => void {
    const originals = new Map<keyof typeof LEVELS, (...args: unknown[]) => void>();
    for (const m of Object.keys(LEVELS) as Array<keyof typeof LEVELS>) {
        const orig = console[m].bind(console);
        originals.set(m, console[m]);
        console[m] = (...args: unknown[]) => {
            orig(...args);
            try {
                send(LEVELS[m], args.map(formatConsoleArg).join(' '));
            } catch {
                // The listener is gone (a realm tearing down); the console still printed.
            }
        };
    }
    return () => { for (const [m, fn] of originals) console[m] = fn; };
}
