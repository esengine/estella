// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  font-revision.ts — one number that moves whenever the family a `Text` resolves to can have changed.
 *
 * A label is laid out from `resolveTextFamily(font, fontFamily)`, and that answer changes without the `Text` being written:
 * a project font or a bitmap font registered or released under the handle the label holds. A reader that keeps what it
 * drew compares this number instead of resolving every label again.
 */

let revision = 0;

/** @internal Every registration and release in a font registry calls this. */
export function noteFontsChanged(): void {
    revision++;
}

/** @internal The registries' revision: equal across two reads means no font a label resolves through has changed. */
export function fontsRevision(): number {
    return revision;
}
