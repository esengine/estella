// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    ui/binding/bind.ts
 * @brief   bind — drive a component field from a {@link ReadonlySignal}.
 *
 * The declarative replacement for the imperative "read the component, mutate the
 * field, insert it back" every UI-from-state update used to be. The field is set
 * immediately, then tracks the signal; the binding auto-disposes when the entity
 * despawns (and returns a manual dispose).
 */
import type { World } from '../../ecs/world';
import type { Entity } from '../../types';
import type { ComponentDef } from '../../ecs/component';
import type { ReadonlySignal } from './signal';

/**
 * Bind `source` to `entity`'s `component.field`: applied now and on every change.
 * Writes are guarded (skipped if the entity is gone or lacks the component), and
 * the binding tears itself down when the entity despawns. Returns a dispose to
 * unbind early.
 */
export function bind<C extends object, K extends keyof C>(
    world: World,
    entity: Entity,
    component: ComponentDef<C>,
    field: K,
    source: ReadonlySignal<C[K]>,
): () => void {
    let disposed = false;

    const apply = (value: C[K]): void => {
        if (disposed || !world.valid(entity) || !world.has(entity, component)) return;
        const data = world.get(entity, component) as C;
        world.insert(entity, component, { ...data, [field]: value });
    };

    apply(source.get()); // seed the field with the current value

    const unsub = source.subscribe(apply);
    const dispose = (): void => {
        if (disposed) return;
        disposed = true;
        unsub();
        offDespawn();
    };
    const offDespawn = world.onDespawn((e) => {
        if (e === entity) dispose();
    });

    return dispose;
}
