// Native harness for Log format-string precision parsing (Audit A1).
//
// Old code parsed float precision with std::stoi(substr(...)), which THROWS on
// malformed specs like "{:.f}" (empty precision) — and under -fno-exceptions
// (the engine's release config) a throw aborts the entire module. The fix uses
// std::from_chars, which never throws. Compile this with -fno-exceptions to
// reproduce the original abort and prove the fix.
//
//   clang++ -std=c++20 -fno-exceptions -I src \
//     tests/core/test_log_format.cpp src/esengine/core/Log.cpp -o /tmp/test_log

#include "esengine/core/Log.hpp"

#include <cstdio>

int main() {
    using esengine::Log;

    // The dangerous one: empty precision segment. Old code: stoi("") -> abort.
    Log::info("empty precision: {:.f}", 1.0f);
    // Non-numeric precision. Old code: stoi("x") -> abort.
    Log::info("non-numeric precision: {:.xf}", 2.0f);
    // Well-formed cases must still work.
    Log::info("normal precision: {:.2f}", 3.14159f);
    Log::info("no dot: {:f}", 5.0f);
    Log::info("plain value: {}", 42);

    // Reaching here means none of the malformed specs aborted.
    std::printf("\nA1 OK: malformed float precision specs did not abort\n");
    return 0;
}
