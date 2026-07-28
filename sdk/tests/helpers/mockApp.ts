// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Boot an App wired to the JS-backed mock wasm module (tests/mocks/wasm).
 *        This is the lightweight harness for TS-side plugin logic: the full ECS
 *        works — including wasm-backed BUILTIN components, whose field data the
 *        mock stores in plain JS — with no native binary to build or load.
 *
 *        What the mock does NOT do is run any wasm-side computation (physics
 *        stepping, layout solves, rendering). Use this to assert the TS wiring a
 *        plugin owns — component defaults, registration, reconcile decisions,
 *        system orchestration, event emission — and leave the native simulation
 *        to the *-smoke.mjs runners that link the real engine.
 */
import { App } from '../../src/app';
import { AppContext, setDefaultContext } from '../../src/ecs/context';
import { setEditorMode, setPlayMode } from '../../src/env';
import { createMockModule } from '../mocks/wasm';
import type { ESEngineModule } from '../../src/wasm';

export interface MockApp {
  app: App;
  module: ESEngineModule;
}

/**
 * A fresh App connected to a mock wasm module. Resets the component/system
 * registry (AppContext) and puts the process in standalone play mode so that
 * `playModeOnly()` gameplay systems actually run. Call once per test for
 * isolation; each call starts from a clean registry.
 */
export function bootMockApp(): MockApp {
  setDefaultContext(new AppContext()); // isolate component/system registration per test
  setEditorMode(false);
  setPlayMode(false); // standalone runtime ⇒ playModeOnly() === true
  const app = App.new();
  const module = createMockModule();
  app.world.connectCpp(module.getRegistry(), module);
  return { app, module };
}
