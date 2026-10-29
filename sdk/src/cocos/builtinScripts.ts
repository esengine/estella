// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    cocos/builtinScripts.ts
 * @brief   The parts of the layer that are scripts and systems rather than views: `Button`, and the touch system.
 *
 * A script class and a system are declared into the engine's current context, and a context is what a running app owns — so these
 * are declared once for the one a game runs in, which importing the layer does. A test that replaces the context has to declare them
 * again, and does so here; asking twice for the same context is harmless.
 */
import { getDefaultContext } from '../ecs/context';
import { registerComponent } from '../ecs/component';
import { ContentRect } from '../ui/core/content-rect';
import { declareButton } from './ui/button';
import { declareInputSystem } from './input';
import { declareUiPass } from './ui/pass';
import { declareTweenSystem } from './tween';
import { declarePrefabSystem } from './prefabs';
import { declareGameSystem } from './game';
import { resetClassRegistry } from './registry';

const declared = new WeakSet<object>();

/** Declare the layer's own classes and systems into the current context, once per context. */
export function declareBuiltinScripts(): void {
    const context = getDefaultContext();
    if (declared.has(context)) return;
    declared.add(context);
    // `UITransform` is a view on the engine's rectangle; a scene that holds one needs it registered even in an app without the UI pipeline.
    registerComponent('ContentRect', ContentRect);
    declareButton();
    declareInputSystem();
    declareUiPass();
    declareTweenSystem();
    declarePrefabSystem();
    declareGameSystem();
}

/** Test seam: forget the registry and declare again into the (possibly new) current context. */
export function redeclareBuiltinScripts(): void {
    resetClassRegistry();
    declareBuiltinScripts();
}
