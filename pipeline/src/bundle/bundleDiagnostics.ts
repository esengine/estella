// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Turning a bundler's message into one someone can act on.
 *
 *        A project's scripts are bundled with esbuild, and npm packages come
 *        along — which works, until one of them reaches for a Node built-in.
 *        What comes back then is:
 *
 *          Could not resolve "crypto"
 *
 *        Every word of that is true and none of it helps. It does not say that
 *        the game runs in a browser or a mini-game host where there is no
 *        `crypto` to resolve, it does not say which file asked for it (usually
 *        not one the developer wrote), and it does not say what to do instead.
 *        A developer who has just run `npm install` reads it as "the engine
 *        cannot handle npm packages", which is the wrong conclusion.
 *
 *        The built-in list comes from Node itself rather than a copy kept here:
 *        a hand-maintained list is one that is wrong the first time Node adds a
 *        module, and being wrong here means silently NOT explaining the error
 *        the developer is actually looking at.
 *
 *        Pure — the message in, a better message out — so the four bundling
 *        paths (web/desktop, mini-game, playable, and the editor's Play realm)
 *        can share it and the tests need no bundler.
 */
import { builtinModules } from 'node:module';

/** esbuild's `Message`, narrowed to what an explanation can use. */
export interface BundleMessage {
    text: string;
    location?: { file?: string } | null;
}

const BUILTINS = new Set(builtinModules);

/** `Could not resolve "x"` — esbuild's wording for a specifier it could not find. */
const UNRESOLVED = /^Could not resolve "([^"]+)"/;

/** Whether a specifier names a Node built-in, in either spelling. */
export function isNodeBuiltin(specifier: string): boolean {
    const bare = specifier.startsWith('node:') ? specifier.slice('node:'.length) : specifier;
    // Subpaths are real (`node:fs/promises`), and the root is what identifies it.
    return BUILTINS.has(bare) || BUILTINS.has(bare.split('/')[0] ?? '');
}

/**
 * esbuild's message, plus what to do about it — when there is something to say.
 *
 * Anything unrecognized passes through untouched. A wrong guess appended to a
 * real compile error costs more than the explanation is worth, so this only
 * speaks about the one case it can identify with certainty.
 */
export function explainBundleError(message: BundleMessage): string {
    const match = UNRESOLVED.exec(message.text);
    const specifier = match?.[1];
    if (!specifier || !isNodeBuiltin(specifier)) return message.text;

    const from = message.location?.file;
    // Where it came from decides the advice. Something under node_modules means a
    // dependency reached for it and the developer's own code is fine — the fix is
    // a different package or entry point, not a different import.
    const viaDependency = !!from && /(^|[\\/])node_modules[\\/]/.test(from);

    const where = from ? ` (imported by ${from})` : '';
    const why = `"${specifier}" is a Node built-in, and a game does not run in Node — `
        + 'the web build runs in a browser, and a mini-game host has neither Node nor the DOM.';
    const how = viaDependency
        ? 'This came from a dependency, so the fix is on the package rather than in your code: '
            + 'many publish a browser-safe entry point (protobufjs/minimal, for one), and some ship a '
            + '"browser" field npm and esbuild will pick automatically. If it has neither, it cannot be '
            + 'bundled into a game.'
        : 'Use a web API instead (crypto.subtle, fetch, localStorage), or the engine\'s own equivalent — '
            + 'Assets for files, Storage for saved data — all of which work on every target.';
    return `${message.text}${where}. ${why} ${how}`;
}

/** Map a batch of esbuild messages, explaining the ones that can be explained. */
export function explainBundleErrors(messages: readonly BundleMessage[]): string[] {
    return messages.map(explainBundleError);
}
