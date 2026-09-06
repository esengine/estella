// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  setup.ts — each test starts with the registry the SDK left it, minus
 *        whatever the previous test registered.
 *
 * Clearing to EMPTY was wrong, and quietly so. Engine components (animation,
 * timeline, AI, audio, joints, UI text, tilemap) `defineComponent` at module
 * load into the same per-app user registry a project's own use, and a module
 * body runs once — so a clear takes them out with nothing to put them back.
 * What follows is not a failure but an identity pose, an unwritten joint, a
 * query that matches nothing: the shapes an assertion cannot tell from a
 * correct answer.
 *
 * The snapshot has to be taken HERE and not at module load: a setup file's body
 * runs before the file under test is imported, with 25 of the engine's 65
 * components registered — the rest arrive with that file's own imports, and the
 * first beforeEach is the earliest point at which they have.
 */
import { beforeEach } from 'vitest';
import {
    clearUserComponents, markEngineComponentBaseline, seedEngineComponents,
} from '../src/ecs/component';

let baselineTaken = false;

beforeEach(() => {
    if (!baselineTaken) {
        markEngineComponentBaseline();
        baselineTaken = true;
    }
    clearUserComponents();
    seedEngineComponents();
});
