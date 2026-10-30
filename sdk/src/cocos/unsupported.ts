// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    cocos/unsupported.ts
 * @brief   What a script gets for a part of Cocos the layer does not provide, so one missing name does not take the whole project down.
 *
 * Cocos hands a script `undefined` for a name it does not export, and a project's scripts are evaluated together: the first one that
 * reaches into such a name while its module loads (`new gfx.Attribute(...)` to build a vertex format, say) throws, and every script
 * after it never registers. This is a stand-in that survives being read, called and constructed, answers with more of itself, and says
 * once, by name, that the part is not there. It does nothing: a script that really needs what it stands for will not work, but the
 * rest of the project still starts.
 */
import { log } from '../util/logger';

const told = new Set<string>();

function tell(name: string): void {
    const top = name.split(/[.(]/).slice(0, 2).join('.');
    if (told.has(top)) return;
    told.add(top);
    log.warn('cocos', `${top} is not provided by the compatibility layer; scripts that use it will not behave as they do in Cocos`);
}

/** A stand-in for `cc.<name>`, which the layer does not have. */
export function unsupported(name: string): any {
    const children = new Map<string, unknown>();
    const make = (path: string): unknown => {
        const target = function () { /* a stand-in */ } as unknown as Record<PropertyKey, unknown>;
        return new Proxy(target, {
            get(self, key) {
                if (key === 'prototype') return self.prototype;
                if (key === Symbol.toPrimitive) return () => '';
                if (typeof key === 'symbol' || key === 'then') return undefined;
                const child = `${path}.${key}`;
                let found = children.get(child);
                if (found === undefined) { found = make(child); children.set(child, found); }
                return found;
            },
            set: () => true,
            apply: () => { tell(path); return make(`${path}()`); },
            construct: () => { tell(path); return make(`${path}()`) as object; },
        });
    };
    return make(`cc.${name}`);
}
