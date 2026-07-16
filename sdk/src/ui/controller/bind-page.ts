// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    ui/controller/bind-page.ts
 * @brief   bindControllerPage — drive a controller's page from a Signal.
 *
 * The data-layer bridge into a controller: a reactive value (see binding/signal)
 * that names the current page, applied now and on every change. This is the
 * declarative path to a data-driven tab bar / view switcher — set the signal, the
 * controller switches page, and every geared element reflows. Mirrors `bind`
 * (seed + subscribe + auto-dispose on despawn); the target is a controller's
 * `current` rather than a plain component field, so it goes through
 * {@link setControllerPage} instead of a raw insert.
 */
import type { World } from '../../world';
import type { Entity } from '../../types';
import type { ReadonlySignal } from '../binding/signal';
import { setControllerPage } from './ui-controller';

/**
 * Bind `source` (a page name) to the nearest controller named `controller`
 * (self → ancestors from `entity`): applied now and on every change. Unknown
 * pages/controllers are ignored (see {@link setControllerPage}); the binding tears
 * itself down when `entity` despawns. Returns a dispose to unbind early.
 */
export function bindControllerPage(
    world: World,
    entity: Entity,
    controller: string,
    source: ReadonlySignal<string>,
): () => void {
    let disposed = false;

    const apply = (page: string): void => {
        if (disposed || !world.valid(entity)) return;
        setControllerPage(world, entity, controller, page);
    };

    apply(source.get()); // seed the controller with the current page

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
