// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    Bench.hpp
 * @brief   What a frame COSTS on this host — the number AOT exists for, measured
 *          where the constraint AOT exists for actually holds.
 * @details Every frame number this engine has ever published came from a host with
 *          a JIT: V8 on the desktop, Chromium on the phone. As `bench/aot-frame`'s
 *          own README puts it, the number the road was built for is the no-JIT
 *          one — and the plan's way to get it was a Mac running
 *          Bun/JavaScriptCore.
 *
 *          The proxy stopped being necessary the day this host learned to dispatch
 *          to compiled systems. It embeds QuickJS-ng, which has no JIT — the same
 *          constraint iOS puts on JavaScriptCore — so a desktop build IS a no-JIT
 *          measurement of the real engine, the real SDK and a real exported
 *          project. What was missing was not a harness. It was a clock.
 *
 *          Four spans, because one number cannot say what it is a share OF:
 *          - `update` — the `update` call itself, which on this host only
 *            SCHEDULES the tick. `App.tick` is async, so it returns at its first
 *            await; measured, this span is ~8us of a 52ms frame. It is reported
 *            so that nobody mistakes it for the tick again.
 *          - `pump` — the microtask drain that follows, where the systems and the
 *            render they drive actually run. THIS is what AOT moves.
 *          - `cpu` — the host's whole frame up to `present()`. Amdahl's
 *            denominator: `pump / cpu` is the fraction a compiler can reach.
 *          - `frame` — including `present()`, for reference.
 *
 *          A bench also asks the swapchain to stop waiting for the display
 *          (`setPresentUncapped`). Under Fifo every frame cheaper than the refresh
 *          interval reads as exactly the refresh interval and every frame dearer
 *          than it reads as a multiple of one: measured here, a 52ms interpreted
 *          frame and a 1.8ms compiled one both read as "16.67ms" and "52ms" —
 *          a 30x difference quantised into a 3x one.
 *
 *          Driven by the environment, so nothing about a shipped game changes:
 *          - `ESTELLA_BENCH_FRAMES`  timed frames; presence enables the bench.
 *          - `ESTELLA_BENCH_WARMUP`  untimed frames first (default 120) — assets
 *                                    land, pools fill, and a lazily-bound compiled
 *                                    system gets to be bound before it is timed.
 *          - `ESTELLA_BENCH_DT`      fixed delta in seconds (default 1/60). A bench
 *                                    stepped by the wall clock measures the wall
 *                                    clock: two builds would see different deltas,
 *                                    move different distances, and have no
 *                                    differential between them.
 *          - `ESTELLA_BENCH_LABEL`   tag echoed in the result line.
 *          - `ESTELLA_BENCH_QUIT`    `0` to keep running after the report; the
 *                                    default is to exit, which is what a runner
 *                                    comparing two builds wants.
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the Apache License, Version 2.0.
 */
#pragma once

namespace eshost {

/** Whether a bench was asked for. */
bool benchWanted();

/** The delta the frame should use. Returns @p wall untouched unless a bench is
 *  running, in which case every frame gets the same fixed step — see the header. */
double benchDelta(double wall);

/** Frame boundaries and the span around the SDK tick. All four are no-ops unless
 *  a bench was asked for. */
void benchFrameBegin();
void benchUpdateBegin();
void benchUpdateEnd();

/** The microtask drain the tick's continuation runs in. On this host `update`
 *  only SCHEDULES the App tick — an async function returns at its first await —
 *  so the systems, and the render they drive, are timed here. */
void benchPumpBegin();
void benchPumpEnd();

/** Close the frame's CPU span. Call immediately BEFORE `present()`. */
void benchBeforePresent();

/** What the frame DREW, carried into the report. A body that moves a sprite's z
 *  can break the batching and pay for it in the render rather than in itself, and
 *  a cost that lands somewhere the report cannot see reads as the system's. */
void benchNoteDraws(unsigned draws, unsigned sprites);

/**
 * What a compiled system covered, and what it had to write, added to this
 * frame's totals.
 *
 * Counts beside the clocks: both regressions here — a dispatcher back to
 * offering every entity alive, and a row table that stops being reused — cost
 * time in proportion to the world, which on a busy machine reads as noise.
 * These are exact, so a gate can assert them with no tolerance.
 */
void benchNoteAotCandidates(unsigned candidates, unsigned packed);

/** Close the frame, and report once the last timed one is in.
 *  @return true when the host was asked to quit and the report is out. */
bool benchFrameEnd();

}  // namespace eshost
