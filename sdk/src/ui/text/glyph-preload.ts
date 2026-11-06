// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    ui/text/glyph-preload.ts
 * @brief   Putting glyphs on the atlas before they are shown, a few milliseconds a frame.
 *
 * A character costs the frame it first appears in. One is nothing; the first page
 * of a novel is hundreds, and on a phone that frame runs long. A game knows what it
 * is about to show, so it can spend that time on its loading screen instead, spread
 * over frames rather than in one.
 *
 * This holds only the walk: which character is next, and when the frame's budget is
 * spent. Producing a glyph is the sink's, so a preloaded glyph is the same atlas cell
 * the layout would have asked for (TextPlugin.preload).
 */

export interface GlyphPreloadOptions {
    /** Milliseconds of glyph work per frame. A loading screen with nothing else to do can give it more. Default 4. */
    budgetMs?: number;
}

export interface GlyphPreload {
    /** Characters done over characters asked for, 0 to 1. */
    readonly progress: number;
    /** Resolves when every character is on the atlas, or the preload was released first. */
    readonly done: Promise<void>;
    /**
     * Stop, if it has not finished, and let the atlas pages go. Preloaded glyphs keep their pages until this is called, since a page no
     * text is showing is otherwise released at the next frame: call it when the chapter they were for is over. Text showing them keeps
     * what it uses.
     */
    release(): void;
}

export const DEFAULT_PRELOAD_BUDGET_MS = 4;

/** The distinct characters of @p text that have a glyph to make: control characters (a line break) do not. */
export function preloadCodepoints(text: string): number[] {
    const seen = new Set<number>();
    for (const ch of text) {
        const cp = ch.codePointAt(0)!;
        if (cp >= 0x20) seen.add(cp);
    }
    return [...seen];
}

export class GlyphPreloadJob implements GlyphPreload {
    readonly done: Promise<void>;
    private resolve_!: () => void;
    private next_ = 0;
    private finished_ = false;

    /** @param onRelease Lets go of what the job holds; called once, by release() only. */
    constructor(
        private readonly codepoints: readonly number[],
        private readonly budgetMs: number,
        private readonly onRelease: () => void,
    ) {
        this.done = new Promise((resolve) => { this.resolve_ = resolve; });
        if (codepoints.length === 0) this.finish();
    }

    get progress(): number {
        return this.codepoints.length === 0 ? 1 : this.next_ / this.codepoints.length;
    }

    get finished(): boolean { return this.finished_; }

    /** Feed @p make characters until the budget on @p now is spent. At least one, so a slow device still gets there. */
    step(make: (codepoint: number) => void, now: () => number): void {
        if (this.finished_) return;
        const end = now() + this.budgetMs;
        do {
            make(this.codepoints[this.next_]!);
            this.next_++;
        } while (this.next_ < this.codepoints.length && now() < end);
        if (this.next_ >= this.codepoints.length) this.finish();
    }

    /** No more work is coming: the entity is gone, or the host is. */
    finish(): void {
        if (this.finished_) return;
        this.finished_ = true;
        this.resolve_();
    }

    release(): void {
        this.finish();
        this.onRelease();
    }
}
