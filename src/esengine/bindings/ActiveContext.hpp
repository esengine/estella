// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#pragma once


#include "../core/EstellaContext.hpp"
#include "EngineContext.hpp"  // unset-fallback default context (see activeCtx)

namespace esengine {

/**
 * @brief The explicitly-installed active engine context (or null if none).
 * @details Set by setActiveContext (REARCH_ENGINE_INSTANCING) or, until N3, by
 *          the legacy initRenderer path. Read through {@link activeCtx}.
 */
inline EstellaContext* g_activeContext = nullptr;

/**
 * @brief The engine context every binding routes through — single source of truth.
 *
 * @details Returns the explicitly-installed context when present; otherwise falls
 *          back to the process default context (`EngineContext::instance`), whose
 *          constructor registers the GPU-independent logic systems, so headless
 *          tooling/tests that never call initRenderer can still run UI layout /
 *          hit-test instead of dereferencing nullptr. The default is just the
 *          unset fallback, **not** a privileged singleton — real Apps install
 *          their own context via setActiveContext.
 *
 *          Putting the fallback here (rather than in each binding file's local
 *          `ctx()`) makes headless-vs-rendered behavior **uniform**: before, only
 *          WebSDKEntry's `ctx()` had the fallback and the other binding files
 *          dereferenced `g_activeContext` bare → null deref when headless.
 */
inline EstellaContext& activeCtx() {
    return g_activeContext ? *g_activeContext : EngineContext::instance().context();
}

}  // namespace esengine

