// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
//
// Does the boot record survive the thing it exists for?
//
// A crash handler that has never handled a crash is a comment. This runs the
// real BootLog.cpp on a real device, faults for real, and leaves the file behind
// for the caller to read — so the claim "a player can send us the crash" is
// something that was observed rather than intended.
//
// Built and run by tools/verify-bootlog-crash.mjs; not part of the host.
//
//   bootlog_crash_test <dir> [--no-crash]

#include "../host/BootLog.hpp"

#include <cstdio>
#include <cstring>
#include <string>

int main(int argc, char** argv) {
    if (argc < 2) {
        std::fprintf(stderr, "usage: bootlog_crash_test <dir> [--no-crash]\n");
        return 2;
    }
    const bool crash = !(argc > 2 && std::strcmp(argv[2], "--no-crash") == 0);

    eshost::openBootLog(argv[1]);
    if (eshost::bootLogPath().empty()) {
        std::fprintf(stderr, "no record opened in %s\n", argv[1]);
        return 3;
    }
    eshost::installCrashHandler();

    // Second run: the first one crashed, so its record should now be copied
    // somewhere a player could browse to. Printed for the caller to check.
    const std::string published = eshost::publishPreviousCrash({std::string(argv[1]) + "/public"});
    std::printf("PUBLISHED=%s\n", published.c_str());

    eshost::bootPhase("gpu device");
    eshost::bootNote("device: a test, not a phone");
    eshost::bootPhase("engine context");
    eshost::bootLogLine(false, "a line the host would have logged");
    eshost::bootPhase("js runtime");

    if (!crash) {
        eshost::bootReady(1.0);
        std::printf("%s\n", eshost::bootLogPath().c_str());
        return 0;
    }

    // The point. Volatile so it survives the optimizer, and a null store rather
    // than abort() because a bad pointer is what actually happens in the field.
    std::printf("%s\n", eshost::bootLogPath().c_str());
    std::fflush(stdout);
    *static_cast<volatile int*>(nullptr) = 1;
    return 0;   // not reached
}
