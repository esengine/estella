/**
 * @file    SceneTransitionController.ts
 * @brief   Fade transition state machine for scene switches.
 *
 * Extracted from the monolithic SceneManagerState so the sequencing
 * (fade-out → loading → fade-in) and its overlay-drawing side effect
 * live in one self-contained unit. SceneManagerState owns an instance
 * of this controller and drives it from `updateTransition()`.
 */
import type { Color } from '../types';
import { registerDrawCallback, unregisterDrawCallback } from '../customDraw';
import { Draw } from '../draw';
import { log } from '../logger';

export interface FadeTransitionOptions {
    readonly duration: number;
    readonly color: Color;
    readonly onStart?: () => void;
    readonly onComplete?: () => void;
}

/**
 * Fade transition runs in three phases:
 *  - fade-out: overlay alpha ramps 0 → 1 over duration/2
 *  - loading: overlay stays fully opaque while the old scene unloads and the
 *    new one loads. Visual hold absorbs any load latency and prevents a
 *    black-screen flash if the swap takes longer than the timer.
 *  - fade-in: overlay alpha ramps 1 → 0 over duration/2
 *
 * Only a completed fade-in resolves the caller's promise. Any failure during
 * the `loading` phase rejects it with the original error.
 */
type TransitionPhase = 'fade-out' | 'loading' | 'fade-in';

type SwitchOutcome =
    | { readonly status: 'pending' }
    | { readonly status: 'success' }
    | { readonly status: 'error'; readonly error: unknown };

interface TransitionState {
    phase: TransitionPhase;
    elapsed: number;
    duration: number;
    color: Color;
    resolve: () => void;
    reject: (reason?: unknown) => void;
    onComplete: (() => void) | undefined;
    outcome: SwitchOutcome;
}

const TRANSITION_CALLBACK_ID = '__scene_transition_overlay__';
const OVERLAY_SIZE = 20000;

export class SceneTransitionController {
    private state_: TransitionState | null = null;

    isTransitioning(): boolean {
        return this.state_ !== null;
    }

    /**
     * Begin a fade transition. The returned promise resolves after fade-in
     * completes following a successful `performSwap`, or rejects with
     * `performSwap`'s error. The controller drives the visual overlay via
     * `Draw.rect` on every frame until the state machine clears itself.
     */
    start(options: FadeTransitionOptions, performSwap: () => Promise<void>): Promise<void> {
        return new Promise((resolve, reject) => {
            const { duration, color, onComplete } = options;

            options.onStart?.();

            this.state_ = {
                phase: 'fade-out',
                elapsed: 0,
                duration,
                color,
                resolve,
                reject,
                onComplete,
                outcome: { status: 'pending' },
            };

            registerDrawCallback(TRANSITION_CALLBACK_ID, () => this.drawOverlay_());

            // Fire the swap when we enter the 'loading' phase, not now — the
            // fade-out needs to finish first. We kick it off from update().
            this.performSwap_ = performSwap;
        });
    }

    /** Advance the state machine by `dt` seconds. */
    update(dt: number): void {
        if (!this.state_) return;

        this.state_.elapsed += dt;
        const halfDuration = this.state_.duration / 2;

        // Phase 1 → 2: fade-out reached full opacity. Start the swap; hold
        // the overlay fully opaque while it runs.
        if (this.state_.phase === 'fade-out' && this.state_.elapsed >= halfDuration) {
            this.state_.phase = 'loading';
            this.state_.elapsed = 0;
            this.kickSwap_();
        }

        // Phase 2 → 3 or reject: loading polls the outcome each frame. Elapsed
        // is clamped to 0 so the overlay never fades back in prematurely —
        // visual hold until the outcome is known.
        if (this.state_.phase === 'loading') {
            const outcome = this.state_.outcome;
            if (outcome.status === 'pending') {
                this.state_.elapsed = 0;
                return;
            }
            if (outcome.status === 'error') {
                const { reject } = this.state_;
                this.teardown_();
                reject(outcome.error);
                return;
            }
            // success → start fade-in
            this.state_.phase = 'fade-in';
            this.state_.elapsed = 0;
            return;
        }

        // Phase 3: fade-in done → resolve caller's promise.
        if (this.state_.phase === 'fade-in' && this.state_.elapsed >= halfDuration) {
            const { resolve, onComplete } = this.state_;
            this.teardown_();
            onComplete?.();
            resolve();
        }
    }

    /** Forcibly drop any in-flight transition without resolving or rejecting. */
    reset(): void {
        if (this.state_) {
            this.teardown_();
        }
    }

    private performSwap_: (() => Promise<void>) | null = null;

    private kickSwap_(): void {
        const state = this.state_;
        const swap = this.performSwap_;
        this.performSwap_ = null;
        if (!state || !swap) return;

        void (async () => {
            try {
                await swap();
                // Only record success if this transition is still the in-flight
                // one (reset/replace could have cleared state_ meanwhile).
                if (this.state_ === state) {
                    state.outcome = { status: 'success' };
                }
            } catch (err) {
                log.error('scene', 'Scene transition failed', err);
                if (this.state_ === state) {
                    state.outcome = { status: 'error', error: err };
                }
            }
        })();
    }

    private teardown_(): void {
        this.state_ = null;
        this.performSwap_ = null;
        unregisterDrawCallback(TRANSITION_CALLBACK_ID);
    }

    private drawOverlay_(): void {
        const state = this.state_;
        if (!state) return;
        const halfDuration = state.duration / 2;
        let alpha: number;
        switch (state.phase) {
            case 'fade-out':
                alpha = Math.min(state.elapsed / halfDuration, 1);
                break;
            case 'loading':
                alpha = 1;
                break;
            case 'fade-in':
                alpha = Math.max(1 - state.elapsed / halfDuration, 0);
                break;
        }
        Draw.setLayer(9999);
        Draw.setDepth(9999);
        Draw.rect(
            { x: 0, y: 0 },
            { x: OVERLAY_SIZE, y: OVERLAY_SIZE },
            { r: state.color.r, g: state.color.g, b: state.color.b, a: alpha },
        );
    }
}
