// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team

#include "BootLog.hpp"

#include <cstdarg>
#include <cstdio>
#include <cstring>
#include <ctime>
#include <string>

#include <filesystem>

// The crash handler is POSIX: signals, libunwind, dladdr. Windows catches a crash
// through SEH and DbgHelp instead — a different implementation, not a different
// spelling — so there the boot record works and the handler is absent.
#if !defined(_WIN32)
#include <csignal>
#include <dlfcn.h>
#include <unistd.h>
#include <unwind.h>
#endif

namespace eshost {
namespace {

FILE* g_file = nullptr;
std::string g_path;
/// The run before this one — read once, to see whether it ended in a crash.
std::string g_prev;
const char* g_phase = "(none)";
/// The same file, as a descriptor — what the signal handler is allowed to use.
int g_fd = -1;

/** Wall-clock, ISO-ish. The record is read by a person comparing it against
 *  "it broke this afternoon", so it wants the clock, not the monotonic timer. */
std::string stamp() {
    std::time_t t = std::time(nullptr);
    std::tm tm{};
#if defined(_WIN32)
    localtime_s(&tm, &t);
#else
    localtime_r(&t, &tm);
#endif
    char buf[32];
    std::strftime(buf, sizeof(buf), "%Y-%m-%d %H:%M:%S", &tm);
    return buf;
}

/** The same clock as the header, in a form a filename can carry. */
std::string fileStamp() {
    std::time_t t = std::time(nullptr);
    std::tm tm{};
#if defined(_WIN32)
    localtime_s(&tm, &t);
#else
    localtime_r(&t, &tm);
#endif
    char buf[32];
    std::strftime(buf, sizeof(buf), "%Y%m%d-%H%M%S", &tm);
    return buf;
}

/** mkdir -p, for a public directory this app has never written to before. */
void mkdirs(const std::string& dir) {
    std::error_code ignored;
    std::filesystem::create_directories(dir, ignored);
}

void writeLine(const char* prefix, const char* text) {
    if (!g_file) return;
    std::fprintf(g_file, "%s%s\n", prefix, text);
    // Flushed per line, not per buffer: a launch that is about to die is exactly
    // the one whose last line matters, and a buffered line is one the crash eats.
    std::fflush(g_file);
}

}  // namespace

void openBootLog(const std::string& dir) {
    if (dir.empty()) return;

    g_path = dir + "/estella-boot.log";
    g_prev = dir + "/estella-boot.prev.log";
    std::remove(g_prev.c_str());
    std::rename(g_path.c_str(), g_prev.c_str());

    g_file = std::fopen(g_path.c_str(), "w");
    if (!g_file) { g_path.clear(); return; }
    g_fd = fileno(g_file);

    std::fprintf(g_file, "estella boot record — %s\n", stamp().c_str());
    std::fflush(g_file);
}

void bootPhase(const char* name) {
    g_phase = name ? name : "(none)";
    writeLine("phase: ", g_phase);
}

void bootNote(const char* fmt, ...) {
    char buf[1024];
    va_list args;
    va_start(args, fmt);
    std::vsnprintf(buf, sizeof(buf), fmt, args);
    va_end(args);
    writeLine("", buf);
}

void bootReady(double ms) {
    char buf[128];
    std::snprintf(buf, sizeof(buf), "ready in %.0f ms", ms);
    writeLine("", buf);
}

void bootLogLine(bool error, const char* message) {
    if (!g_file || !message) return;
    // Errors carry the phase they happened in: the file is read top-down by
    // someone who wants to know where it stopped, and an error that names its own
    // phase answers that without counting lines.
    if (error) {
        std::fprintf(g_file, "ERROR [%s] %s\n", g_phase, message);
    } else {
        std::fprintf(g_file, "  %s\n", message);
    }
    std::fflush(g_file);
}

const std::string& bootLogPath() { return g_path; }

std::string publishPreviousCrash(const std::vector<std::string>& dirs) {
    if (g_prev.empty() || dirs.empty()) return {};

    // Only a crash is worth publishing. A record that ends in "ready in" is the
    // last healthy run, and copying that into someone's file manager every launch
    // is litter.
    std::string text;
    {
        FILE* f = std::fopen(g_prev.c_str(), "rb");
        if (!f) return {};
        char buf[4096];
        size_t got = 0;
        while ((got = std::fread(buf, 1, sizeof(buf), f)) > 0) text.append(buf, got);
        std::fclose(f);
    }
    if (text.find("FATAL ") == std::string::npos) return {};

    const std::string name = "estella-crash-" + fileStamp() + ".log";
    for (const std::string& dir : dirs) {
        mkdirs(dir);
        const std::string dest = dir + "/" + name;
        FILE* out = std::fopen(dest.c_str(), "wb");
        if (!out) continue;
        const bool wrote = std::fwrite(text.data(), 1, text.size(), out) == text.size();
        std::fclose(out);
        if (wrote) return dest;
        std::remove(dest.c_str());
    }
    return {};
}

#if defined(_WIN32)

// A Windows crash handler is SetUnhandledExceptionFilter + DbgHelp, which is its
// own piece of work; until it exists a crash leaves the boot record it had
// written, and no backtrace.
void installCrashHandler() {}

#else

// =============================================================================
// The crash handler
// =============================================================================

namespace {

/** write(2) a NUL-terminated string. The only output primitive a signal handler
 *  is allowed; a partial write is retried because a signal can interrupt one. */
void rawWrite(const char* s) {
    if (g_fd < 0 || !s) return;
    size_t n = std::strlen(s);
    while (n > 0) {
        const ssize_t got = write(g_fd, s, n);
        if (got <= 0) return;
        s += got;
        n -= (size_t)got;
    }
}

/** An unsigned value in hex, without printf. */
void rawHex(uintptr_t v) {
    char buf[2 + sizeof(uintptr_t) * 2 + 1];
    char* p = buf + sizeof(buf) - 1;
    *p = '\0';
    do { *--p = "0123456789abcdef"[v & 0xf]; v >>= 4; } while (v);
    *--p = 'x';
    *--p = '0';
    rawWrite(p);
}

struct Frames {
    static constexpr int kMax = 32;
    void* pc[kMax];
    int n = 0;
};

_Unwind_Reason_Code collectFrame(_Unwind_Context* ctx, void* arg) {
    auto* f = static_cast<Frames*>(arg);
    const uintptr_t ip = _Unwind_GetIP(ctx);
    if (ip && f->n < Frames::kMax) f->pc[f->n++] = reinterpret_cast<void*>(ip);
    return f->n >= Frames::kMax ? _URC_END_OF_STACK : _URC_NO_REASON;
}

const char* signalName(int sig) {
    switch (sig) {
        case SIGSEGV: return "SIGSEGV (bad memory access)";
        case SIGABRT: return "SIGABRT (abort — an assert or an uncaught throw)";
        case SIGBUS:  return "SIGBUS (misaligned or unmapped access)";
        case SIGFPE:  return "SIGFPE (arithmetic)";
        case SIGILL:  return "SIGILL (illegal instruction)";
        default:      return "signal";
    }
}

void onFatalSignal(int sig, siginfo_t*, void*) {
    rawWrite("\nFATAL ");
    rawWrite(signalName(sig));
    rawWrite(" during phase: ");
    rawWrite(g_phase);
    rawWrite("\nbacktrace (symbolize against this version's unstripped libestella_js_host.so):\n");

    Frames frames;
    _Unwind_Backtrace(collectFrame, &frames);
    for (int i = 0; i < frames.n; i++) {
        rawWrite("  ");
        rawHex(reinterpret_cast<uintptr_t>(frames.pc[i]));
        // dladdr is not formally async-signal-safe, but it is what every Android
        // crash reporter uses here, and a frame with a library and an offset is
        // the difference between a number and an address someone can look up.
        Dl_info info;
        if (dladdr(frames.pc[i], &info) && info.dli_fname) {
            rawWrite("  ");
            rawWrite(info.dli_fname);
            if (info.dli_fbase) {
                rawWrite("+");
                rawHex(reinterpret_cast<uintptr_t>(frames.pc[i])
                       - reinterpret_cast<uintptr_t>(info.dli_fbase));
            }
            if (info.dli_sname) { rawWrite("  "); rawWrite(info.dli_sname); }
        }
        rawWrite("\n");
    }
    fsync(g_fd);

    // Die the way we would have: the OS still writes its tombstone, and the
    // process still reports the same signal to whatever is watching.
    signal(sig, SIG_DFL);
    raise(sig);
}

}  // namespace

void installCrashHandler() {
    if (g_fd < 0) return;   // nowhere to write — nothing to install
    struct sigaction sa = {};
    sa.sa_sigaction = onFatalSignal;
    sa.sa_flags = SA_SIGINFO | SA_ONSTACK;
    sigemptyset(&sa.sa_mask);
    for (int sig : {SIGSEGV, SIGABRT, SIGBUS, SIGFPE, SIGILL}) sigaction(sig, &sa, nullptr);
}

#endif  // _WIN32

}  // namespace eshost
