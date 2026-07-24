// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    hostEnvironment.ts
 * @brief   What a native host's JS engine must provide beyond the language.
 * @details A native host embeds a bare JS engine (QuickJS, JavaScriptCore): it
 *          implements ECMAScript and nothing else. `console`, timers, a clock and
 *          `TextDecoder` are *host* APIs a browser happens to supply — the SDK
 *          uses all four, and on a native host something has to install them.
 *
 *          Without a declared contract each omission is found the hard way, at
 *          the moment some code path first reaches for it: an asset load that
 *          rejects with "setTimeout is not defined", silently, because there is
 *          no console either. This is the checklist, verified at boot so a
 *          missing global is named at the seam instead.
 */

import { assertNativeBindings } from '../../ecs/nativeBindings';

/** A host global the SDK requires, and what breaks without it. */
interface RequiredGlobal {
    name: string;
    /** Nested member that must be callable (e.g. `performance.now`). */
    member?: string;
    used_for: string;
}

const REQUIRED: RequiredGlobal[] = [
    { name: 'console', member: 'error', used_for: 'reporting failures — without it every error is silent' },
    { name: 'setTimeout', used_for: 'the asset cache and any deferred work' },
    { name: 'clearTimeout', used_for: 'cancelling deferred work' },
    { name: 'performance', member: 'now', used_for: 'frame and profiling timings' },
    { name: 'TextDecoder', used_for: 'reading packaged JSON (manifests, scenes, config)' },
];

/**
 * Verify the host installed the JS globals the SDK needs, before anything uses
 * them. {@link assertNativeHost} checks this plus the es_* bindings.
 *
 * @throws naming the first missing global and what it is needed for.
 */
export function assertHostEnvironment(
    scope: Record<string, unknown> = globalThis as unknown as Record<string, unknown>,
): void {
    for (const { name, member, used_for } of REQUIRED) {
        const value = scope[name];
        const present = member
            ? typeof (value as Record<string, unknown> | undefined)?.[member] === 'function'
            : typeof value === 'function';
        if (present) continue;
        const what = member ? `${name}.${member}()` : `${name}()`;
        throw new Error(
            `[native] the host has not installed ${what} — the SDK needs it for ${used_for}. `
            + 'A native host must supply the browser globals its JS engine lacks.',
        );
    }
}

/**
 * The whole native host contract, checked at once: the JS environment a bare
 * engine lacks, and the es_* bindings the shell provides. Call it as the first
 * thing after evaluating the SDK — a shell that is missing something learns it
 * here, by name, rather than from a failure somewhere downstream.
 */
export function assertNativeHost(
    scope: Record<string, unknown> = globalThis as unknown as Record<string, unknown>,
): void {
    assertHostEnvironment(scope);
    assertNativeBindings(scope);
}
