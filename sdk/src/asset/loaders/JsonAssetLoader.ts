// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    JsonAssetLoader.ts
 * @brief   A game's own data — level tables, tuning, dialogue — as an asset.
 *
 * Everything else an engine loads is loaded FOR a subsystem: a texture becomes a
 * GPU handle, a locale table merges into a catalog. This one hands the parsed
 * document straight back, because the subsystem is the game.
 *
 * Being an asset rather than a `fetch` is the whole point: it resolves `@uuid:`
 * refs and manifest paths like every other type, so a file that moves does not
 * break a save; it is cached and reference-counted, so two systems asking for
 * the same table parse it once; it can live in a lazy subpackage or a remote
 * group; and hot update can replace it in a shipped game. A hand-rolled fetch of
 * a project path gets none of that — and worse, it works in the editor (which
 * serves the whole project) and 404s in the build (which ships only assets).
 */
import type { AssetLoader, LoadContext, JsonResult } from '../AssetLoader';

export class JsonAssetLoader implements AssetLoader<JsonResult> {
    readonly type = 'json';
    readonly extensions = ['.json'];

    async load(path: string, ctx: LoadContext): Promise<JsonResult> {
        const buildPath = ctx.catalog.getBuildPath(path);
        const text = await ctx.loadText(buildPath);
        try {
            return { data: JSON.parse(text) as unknown };
        } catch (err) {
            // Name the file: the parser's own message is a line and column in a
            // document the caller never sees.
            throw new Error(`${path}: not valid JSON — ${err instanceof Error ? err.message : String(err)}`);
        }
    }

    unload(): void {
        // A parsed document is plain JS memory the caller may still hold; there
        // is nothing outside the Assets cache to release.
    }
}
