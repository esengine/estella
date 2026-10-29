// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Which script class a component of a Cocos scene is.
 *
 *        A scene does not name a script component's class; it carries the script's uuid in a compressed form
 *        (five hex digits kept, the other twenty-seven as eighteen base64 characters). The uuid is the `.meta`
 *        of the script file, and the class name is what its `@ccclass('...')` says — which is also the name the
 *        compatibility layer registers the component under (`Cocos.<name>`).
 *
 *        Read-only: scripts are read to find the name, never changed or copied.
 */
import { readFileSync } from 'node:fs';
import type { CocosAssetIndex } from './assets';

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Cocos's compressed uuid: what a script component's `__type__` is. */
export function compressUuid(uuid: string): string {
    const hex = uuid.replaceAll('-', '').toLowerCase();
    if (hex.length !== 32) return uuid;
    let out = hex.slice(0, 5);
    for (let i = 5; i < 32; i += 3) {
        const v = parseInt(hex.slice(i, i + 3), 16);
        out += B64[v >> 6]! + B64[v & 63]!;
    }
    return out;
}

export interface ScriptClass {
    /** The `@ccclass` name, which the layer registers as `Cocos.<name>`. */
    name: string;
    /** Path of the script, relative to the project's `assets`. */
    rel: string;
}

const NAMED = /@ccclass\(\s*['"]([^'"]+)['"]\s*\)/;
/** What may sit between the decorator and the class: other decorators, and comments. */
const BETWEEN = String.raw`(?:\s*(?:@[^\r\n]*|//[^\r\n]*))*\s*`;
/** `@ccclass` or `@ccclass()` takes the class's own name. */
const UNNAMED = new RegExp(String.raw`@ccclass(?:\(\s*\))?(?![\w(])${BETWEEN}(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+(\w+)`);

/** The compressed uuid of every script that declares a component class, mapped to that class. */
export function buildScriptIndex(assets: CocosAssetIndex): Map<string, ScriptClass> {
    const out = new Map<string, ScriptClass>();
    for (const entry of assets.byUuid.values()) {
        if (!/\.(ts|js)$/.test(entry.rel) || entry.rel.endsWith('.d.ts')) continue;
        if (entry.importer !== 'typescript' && entry.importer !== 'javascript') continue;
        let text: string;
        try {
            text = readFileSync(entry.file, 'utf8');
        } catch {
            continue;
        }
        const name = NAMED.exec(text)?.[1] ?? UNNAMED.exec(text)?.[1];
        if (!name) continue;
        out.set(compressUuid(entry.uuid), { name, rel: entry.rel });
    }
    return out;
}
