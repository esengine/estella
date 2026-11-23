// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { log } from '../util/logger';
import type { InputEventCallbacks } from './types';

/** Host subscriptions acquired together, released in reverse registration order. */
export class ListenerScope {
    private cleanups_?: Array<() => void> = [];

    add(cleanup: () => void): void {
        if (this.cleanups_) this.cleanups_.push(cleanup);
        else cleanup(); // The host closed the scope during registration.
    }

    listen(source: EventTarget, name: string, listener: EventListener, options?: AddEventListenerOptions): void {
        source.addEventListener(name, listener, options);
        this.add(() => source.removeEventListener(name, listener, options));
    }

    dispose(): void {
        const cleanups = this.cleanups_;
        this.cleanups_ = undefined;
        if (!cleanups) return;
        for (const cleanup of cleanups.reverse()) {
            try { cleanup(); }
            catch (error) { log.warn('platform', 'Failed to release a host listener', error); }
        }
    }
}

/** A platform delivers input to one target at a time. */
export class InputBinding<Owner extends object = InputEventCallbacks> {
    private current_?: { owner: Owner; scope: ListenerScope };

    get owner(): Owner | undefined { return this.current_?.owner; }

    bind(owner: Owner, subscribe: (scope: ListenerScope) => void): void {
        const previous = this.current_;
        const binding = { owner, scope: new ListenerScope() };
        this.current_ = binding;
        previous?.scope.dispose();
        if (this.current_ !== binding) return;
        try {
            subscribe(binding.scope);
        } catch (error) {
            if (this.current_ === binding) this.unbind(owner);
            throw error;
        }
    }

    unbind(owner?: Owner): void {
        const binding = this.current_;
        if (!binding || (owner && owner !== binding.owner)) return;
        this.current_ = undefined;
        binding.scope.dispose();
    }
}
