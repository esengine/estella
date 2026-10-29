// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    cocos/emitter.ts
 * @brief   The `on` / `once` / `off` / `emit` that `game`, `input`, `view` and `screen` share.
 *
 * Cocos's `EventTarget`: a listener is a callback with an optional `this`, `off` removes by callback and/or target, and one
 * listener throwing does not keep the rest from hearing the event.
 */
import { log } from '../util/logger';

type Listener = { callback: (...args: any[]) => void; target?: unknown };

export class Emitter {
    private readonly listeners_ = new Map<string, Listener[]>();

    on(type: string, callback: (...args: any[]) => void, target?: unknown): typeof callback {
        const list = this.listeners_.get(type);
        if (list) list.push({ callback, target }); else this.listeners_.set(type, [{ callback, target }]);
        return callback;
    }

    once(type: string, callback: (...args: any[]) => void, target?: unknown): typeof callback {
        const wrapper = (...args: any[]): void => { this.off(type, wrapper, target); callback.apply(target, args); };
        return this.on(type, wrapper, target);
    }

    /** With a callback: that listener (of that target, if given). With only a target: all of its listeners. With neither: the type's. */
    off(type: string, callback?: (...args: any[]) => void, target?: unknown): void {
        const list = this.listeners_.get(type);
        if (!list) return;
        this.listeners_.set(type, list.filter((l) => {
            if (callback && l.callback !== callback) return true;
            if (target !== undefined && l.target !== target) return true;
            return false;
        }));
    }

    targetOff(target: unknown): void {
        for (const [type, list] of this.listeners_) this.listeners_.set(type, list.filter((l) => l.target !== target));
    }

    hasEventListener(type: string): boolean { return (this.listeners_.get(type)?.length ?? 0) > 0; }

    emit(type: string, ...args: any[]): void {
        for (const l of [...(this.listeners_.get(type) ?? [])]) {
            try {
                l.callback.apply(l.target, args);
            } catch (err) {
                log.error('cocos', `a ${type} listener threw`, err);
            }
        }
    }
}
