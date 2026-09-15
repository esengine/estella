// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    components.ts
 * @brief   What the game remembers. All of it, and the only code here.
 *
 * A graph's variables belong to the entity running it, which is right for a
 * block's own height and wrong for the score: three blocks and a HUD have to
 * agree on it. The engine already has one place a fact can live where anything
 * can read it — a component — so the shared state is one, on one entity, and
 * the graphs reach it with `property.get` / `property.set` naming that entity.
 *
 * Data is a component, logic is a graph. There is no gameplay code in this
 * project beyond this declaration.
 */
import { defineComponent } from 'esengine';

export const GameState = defineComponent('GameState', {
    /** False once a block has caught the player; the graphs gate on it. */
    alive: true,
    /** Blocks dodged. */
    score: 0,
});
