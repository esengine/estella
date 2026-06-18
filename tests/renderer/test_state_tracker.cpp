// Native MSVC/CTest harness for StateTracker (RC5-GfxDevice).
//
// Compiles StateTracker.cpp against MockGfxDevice — no GL, no glm. Verifies the
// bind-dedup cache (program/texture/VAO/VBO/IBO/FBO) that makes StateTracker the
// single authoritative GPU-state cache.

#include "MockGfxDevice.hpp"
#include "esengine/renderer/StateTracker.hpp"

#include <cstdio>

using namespace esengine;

static int g_failures = 0;
#define CHECK(cond, msg)                                                        \
    do {                                                                        \
        if (!(cond)) { std::printf("FAIL: %s\n", msg); ++g_failures; }          \
        else { std::printf("ok:   %s\n", msg); }                                \
    } while (0)

int main() {
    // --- program dedup ---
    {
        MockGfxDevice d;
        StateTracker s(d);
        s.init();
        s.useProgram(7);
        s.useProgram(7);
        s.useProgram(9);
        CHECK(d.useProgramCalls == 2, "useProgram dedups repeats (7,7,9 -> 2 calls)");
    }

    // --- VAO dedup + IBO invalidation on VAO bind ---
    {
        MockGfxDevice d;
        StateTracker s(d);
        s.init();
        s.bindVertexArray(5);
        s.bindVertexArray(5);          // deduped
        CHECK(d.bindVertexArrayCalls == 1, "bindVertexArray dedups repeats");

        s.bindIndexBuffer(7);          // VAO bind invalidated ibo cache -> issues
        s.bindIndexBuffer(7);          // now cached -> deduped
        CHECK(d.bindIndexBufferCalls == 1, "bindIndexBuffer dedups after first bind");

        s.bindVertexArray(6);          // new VAO -> ibo cache invalidated again
        s.bindIndexBuffer(7);          // must re-issue: VAO carries its own element binding
        CHECK(d.bindIndexBufferCalls == 2, "VAO rebind re-issues index buffer (element binding is VAO state)");
        CHECK(d.bindVertexArrayCalls == 2, "second distinct VAO issues");
    }

    // --- VBO dedup is global (not VAO state) + invalidate forces rebind ---
    {
        MockGfxDevice d;
        StateTracker s(d);
        s.init();
        s.bindVertexBuffer(3);
        s.bindVertexBuffer(3);         // deduped
        CHECK(d.bindVertexBufferCalls == 1, "bindVertexBuffer dedups repeats");

        s.invalidateBufferBindings();  // WeChat VAO workaround path
        s.bindVertexBuffer(3);         // forced through
        CHECK(d.bindVertexBufferCalls == 2, "invalidateBufferBindings forces VBO rebind");
    }

    // --- framebuffer dedup ---
    {
        MockGfxDevice d;
        StateTracker s(d);
        s.init();
        s.bindFramebuffer(2);
        s.bindFramebuffer(2);
        s.bindFramebuffer(0);
        CHECK(d.bindFramebufferCalls == 2, "bindFramebuffer dedups repeats (2,2,0 -> 2 calls)");
    }

    // --- reset() marks bindings unknown so first bind per frame always issues ---
    {
        MockGfxDevice d;
        StateTracker s(d);
        s.init();
        s.bindVertexArray(5);
        CHECK(d.bindVertexArrayCalls == 1, "initial VAO bind issues");
        s.reset();
        s.bindVertexArray(5);          // same id, but reset marked unknown -> re-issues
        CHECK(d.bindVertexArrayCalls == 2, "reset() forces re-issue of same VAO id");
    }

    if (g_failures == 0) {
        std::printf("\nALL STATE TRACKER TESTS PASSED\n");
        return 0;
    }
    std::printf("\n%d FAILURE(S)\n", g_failures);
    return 1;
}
