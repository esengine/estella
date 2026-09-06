// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#pragma once
/**
 * @file    TestProbeBindings.hpp
 * @brief   Adapters that exist only to let a driver run an experiment.
 *
 * @details Deliberately NOT in `ENGINE_BINDING_HEADERS`. The header tool that
 *          generates the native entry-point surface does not read `#ifdef`, so a
 *          test adapter declared beside the shipping ones reaches
 *          `nativeEngineApi.generated.ts` however carefully the web registration
 *          is gated — the gate would gate one ABI and not the other. Living in a
 *          file the generator never opens is what makes that impossible rather
 *          than merely unintended.
 */
#include "../core/Types.hpp"

#ifdef ES_ENABLE_TEST_PROBES

namespace esengine {
namespace ecs { class Registry; }

/**
 * @brief Ready the shader programs a set of entities will need, drawing none.
 *
 * @details The EQUIVALENCE oracle. Production readies a cell from its document
 *          (engine_prepareMeshPrograms) precisely because it has no entities
 *          yet; this derives the same requirements from live ones, so a test can
 *          judge the two against each other. Thirteen words to @p outPtr.
 */
void engine_prewarmMeshVariants(ecs::Registry& registry, u32 entitiesPtr, u32 count, u32 outPtr);

}  // namespace esengine

#endif
