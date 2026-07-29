// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
//
// The boot record — what a packaged game leaves behind about how it started.
//
// Everything this host reports goes to the platform log, which means logcat,
// which means a cable and a developer. So when a player says a game closed
// itself, the evidence is on their phone and unreachable, and the only way to
// learn anything is to reproduce it on a device you own — which is exactly what
// you cannot do when the difference is their GPU, their driver, or a build they
// installed and you did not.
//
// This writes the same lines to a file under Platform::logDir(), which a file
// manager can open and a person can send. It records what a failed launch needs
// to be diagnosed FROM THE FILE: what was running, on what, how far it got, and
// what the last error was.
//
// The previous run is kept alongside. An app that dies and is opened again would
// otherwise overwrite the only record of the death with a record of the retry.

#pragma once

#include <string>

namespace eshost {

/**
 * Begin this launch's record in @p dir, moving the previous one aside.
 *
 * Takes the directory rather than the Platform that knows it: this file has no
 * business knowing what a platform is, and a record that depends on nothing can
 * be exercised on its own — which for a crash handler is the difference between
 * a tested one and a hoped-for one.
 *
 * Safe to call before anything else works. An empty @p dir records nothing, and
 * every other entry point stays valid.
 */
void openBootLog(const std::string& dir);

/**
 * Enter a named boot phase.
 *
 * The last phase in the file is where a launch that never finished stopped,
 * which is the one thing a black screen cannot tell you by itself.
 */
void bootPhase(const char* name);

/** Record a fact about this launch (printf-shaped) — a decision worth reading
 *  later, like which source the SDK bundle came from. */
void bootNote(const char* fmt, ...);

/** Mark the launch as fully up. Its absence in a file is what says the game
 *  never got there. */
void bootReady(double ms);

/** Append one already-formatted log line. Called by hostLog, so the record and
 *  the platform log never disagree about what happened. */
void bootLogLine(bool error, const char* message);

/** Where the record is being written, for the one log line that tells a
 *  developer to ask for it. Empty when there is none. */
const std::string& bootLogPath();

/**
 * Catch the signals that end a process, and write what happened into the record
 * before letting it die.
 *
 * Without this a native crash leaves a file that simply stops — the last phase
 * is a hint, and a hint is all. The OS writes a tombstone with the real stack,
 * but a tombstone lives in a directory a player cannot read and is gone by the
 * time anyone asks. This puts the signal, the phase it happened in, and the
 * return addresses next to everything else in the one file they can send; the
 * addresses symbolize offline against the unstripped `libestella_js_host.so`
 * for that version.
 *
 * The handler is written to the rules signal handlers actually have: a raw
 * write(2) to a file descriptor opened up front, no allocation, no stdio. Then
 * it restores the default handler and re-raises, so the OS still produces its
 * own report and the process still dies the way it would have.
 */
void installCrashHandler();

}  // namespace eshost
