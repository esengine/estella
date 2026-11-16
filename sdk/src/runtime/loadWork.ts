// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
export interface LoadWorkProgress {
    done: number;
    total: number;
    label: string;
}

export interface LoadWork {
    readonly pending: boolean;
    run(onProgress?: (progress: LoadWorkProgress) => void): Promise<void>;
    /** The game is being played: what is still being made goes on in short turns, so the frames keep their time. */
    yieldToGame(): void;
}

const NONE: LoadWork = { pending: false, run: async () => undefined, yieldToGame: () => undefined };

let current: LoadWork = NONE;

/** @experimental */
export function setLoadWork(work: LoadWork | null): void {
    current = work ?? NONE;
}

/**
 * What the package still has to make before its content can be shown: the models it carries as recipes, baked on this device. A game runs it
 * behind a loading screen of its own; a game that never asks has it run when the first of that content is loaded.
 * @experimental
 */
export function loadWork(): LoadWork {
    return current;
}
