// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * GLSL → SPIR-V for the shader-twin cook tooling (tools/gen-shader-twins.mjs).
 *
 * A thin C ABI over glslang that mirrors `glslangValidator -V
 * --auto-map-locations` exactly: Vulkan 1.0 client semantics, SPIR-V 1.0,
 * locations auto-mapped for anything the (already binding-explicit) adapted
 * GLSL leaves implicit, no optimizer, no debug info beyond the default OpName
 * identifiers the WGSL twin naming relies on.
 *
 * Built to wasm by tools/glslang-wasm/build.mjs against the pinned
 * third_party/glslang submodule; the artifact is committed under
 * build-tools/shader-twins/ (see its README for provenance).
 */
#include <emscripten.h>

#include <cstdint>
#include <string>
#include <vector>

#include "glslang/Public/ShaderLang.h"
#include "glslang/Public/ResourceLimits.h"
#include "SPIRV/GlslangToSpv.h"

static std::string g_log;
static std::vector<uint32_t> g_spirv;

extern "C" {

EMSCRIPTEN_KEEPALIVE
int es_glslang_initialize() {
    return glslang::InitializeProcess() ? 1 : 0;
}

/**
 * Compile one GLSL stage (0 = vertex, 1 = fragment) to SPIR-V.
 * Returns 1 on success — fetch the words via es_glslang_spirv_data/size;
 * 0 on failure — fetch the info log via es_glslang_log.
 */
EMSCRIPTEN_KEEPALIVE
int es_glslang_compile(const char* source, int stage) {
    g_log.clear();
    g_spirv.clear();

    const EShLanguage lang = (stage == 0) ? EShLangVertex : EShLangFragment;
    glslang::TShader shader(lang);
    const char* sources[] = { source };
    shader.setStrings(sources, 1);
    shader.setEnvInput(glslang::EShSourceGlsl, lang, glslang::EShClientVulkan, 100);
    shader.setEnvClient(glslang::EShClientVulkan, glslang::EShTargetVulkan_1_0);
    shader.setEnvTarget(glslang::EShTargetSpv, glslang::EShTargetSpv_1_0);
    shader.setAutoMapLocations(true);  // --auto-map-locations

    const EShMessages messages = static_cast<EShMessages>(EShMsgSpvRules | EShMsgVulkanRules);
    if (!shader.parse(GetDefaultResources(), 100, false, messages)) {
        g_log = shader.getInfoLog();
        return 0;
    }

    glslang::TProgram program;
    program.addShader(&shader);
    if (!program.link(messages) || !program.mapIO()) {
        g_log = program.getInfoLog();
        return 0;
    }

    glslang::SpvOptions options;
    options.disableOptimizer = true;
    glslang::GlslangToSpv(*program.getIntermediate(lang), g_spirv, &options);
    return 1;
}

EMSCRIPTEN_KEEPALIVE
const uint32_t* es_glslang_spirv_data() { return g_spirv.data(); }

EMSCRIPTEN_KEEPALIVE
int es_glslang_spirv_size() { return static_cast<int>(g_spirv.size()); }

EMSCRIPTEN_KEEPALIVE
const char* es_glslang_log() { return g_log.c_str(); }

}  // extern "C"
