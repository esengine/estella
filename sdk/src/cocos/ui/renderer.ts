// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    cocos/ui/renderer.ts
 * @brief   `UIRenderer`: what every component that draws a 2D UI element is, in Cocos.
 *
 * Cocos builds each element's vertices on the CPU and asks to have them rebuilt when something changed; a script that changes how a
 * label or a sprite is built says so with `markForUpdateRenderData` or `setVertsDirty`. The engine draws from the component's data
 * as it stands, every frame, so there is nothing to rebuild, and these are accepted and do nothing. They are here so the scripts
 * that ask are not stopped by the question.
 */
import { Component } from '../component';

export class UIRenderer extends Component {
    /** Ask for the element's vertices to be rebuilt. The engine draws from current data, so there is nothing to rebuild. */
    markForUpdateRenderData(_enable = true): void { /* drawn from the component's data every frame */ }
    setVertsDirty(): void { /* see markForUpdateRenderData */ }
    updateRenderer(): void { /* see markForUpdateRenderData */ }
    /** A script that replaces `onEnable` on the engine's class calls the base one first; there is nothing to set up here. */
    onEnable(): void { /* the engine draws from the component's data */ }
    /** Whether the element is waiting for a rebuild: never, here. */
    get renderEntity(): undefined { return undefined; }
}
