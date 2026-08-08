# ESEngine Tests

# doctest header-only framework
include_directories(${CMAKE_SOURCE_DIR}/third_party/doctest)

# ECS tests
add_executable(test_ecs
    ecs/test_registry.cpp
)
target_link_libraries(test_ecs PRIVATE esengine)
add_test(NAME test_ecs COMMAND test_ecs)

# Event system tests
add_executable(test_events
    events/test_events.cpp
)
target_link_libraries(test_events PRIVATE esengine)
add_test(NAME test_events COMMAND test_events)

# Particle system tests
add_executable(test_particle
    particle/test_particle.cpp
)
target_link_libraries(test_particle PRIVATE esengine)
add_test(NAME test_particle COMMAND test_particle)

# Tilemap system tests
add_executable(test_tilemap
    tilemap/test_tilemap.cpp
)
target_link_libraries(test_tilemap PRIVATE esengine)
add_test(NAME test_tilemap COMMAND test_tilemap)

# SparseSet tests
add_executable(test_sparse_set
    ecs/test_sparse_set.cpp
)
target_link_libraries(test_sparse_set PRIVATE esengine)
add_test(NAME test_sparse_set COMMAND test_sparse_set)

# View API matrix: instantiates every arity × entry point × callback shape
add_executable(test_view_api_matrix
    ecs/test_view_api_matrix.cpp
)
target_link_libraries(test_view_api_matrix PRIVATE esengine)
add_test(NAME test_view_api_matrix COMMAND test_view_api_matrix)

# ResourcePool tests
add_executable(test_resource_pool
    resource/test_resource_pool.cpp
)
target_link_libraries(test_resource_pool PRIVATE esengine)
add_test(NAME test_resource_pool COMMAND test_resource_pool)

# Shader-vs-device decoupling: compiles the converted Shader.cpp against a
# MockGfxDevice. Linking proves Shader contains no GL; asserts confirm it routes
# create/uniform/reflect/delete through GfxDevice.
add_executable(test_shader_device
    renderer/test_shader_device.cpp
    ${CMAKE_SOURCE_DIR}/src/esengine/renderer/rhi/Shader.cpp
    ${CMAKE_SOURCE_DIR}/src/esengine/renderer/draw/DrawParams.cpp
    ${CMAKE_SOURCE_DIR}/src/esengine/core/Log.cpp
)
target_include_directories(test_shader_device PRIVATE
    ${CMAKE_SOURCE_DIR}/src
    ${CMAKE_SOURCE_DIR}/third_party/glm
)
add_test(NAME test_shader_device COMMAND test_shader_device)

# DrawParams: the loose-uniform → std140 block rewriter + the Shader facade that
# routes setUniform writes into the params UBO seam (MockGfxDevice asserts no
# loose uploads for lifted members).
add_executable(test_draw_params
    renderer/test_draw_params.cpp
    ${CMAKE_SOURCE_DIR}/src/esengine/renderer/rhi/Shader.cpp
    ${CMAKE_SOURCE_DIR}/src/esengine/renderer/draw/DrawParams.cpp
    ${CMAKE_SOURCE_DIR}/src/esengine/core/Log.cpp
)
target_include_directories(test_draw_params PRIVATE
    ${CMAKE_SOURCE_DIR}/src
    ${CMAKE_SOURCE_DIR}/third_party/glm
)
add_test(NAME test_draw_params COMMAND test_draw_params)

# Shader variant (feature-permutation) system (RC7-6). Compiles ShaderParser.cpp
# directly — no GL/engine link — and checks #pragma feature parsing + #define injection.
add_executable(test_shader_variant
    renderer/test_shader_variant.cpp
    ${CMAKE_SOURCE_DIR}/src/esengine/resource/ShaderParser.cpp
    ${CMAKE_SOURCE_DIR}/src/esengine/core/Log.cpp
)
target_include_directories(test_shader_variant PRIVATE ${CMAKE_SOURCE_DIR}/src)
add_test(NAME test_shader_variant COMMAND test_shader_variant)

# Texture + Framebuffer decoupling: compiles the converted classes against a
# MockGfxDevice. The harness stubs the (uncalled) stb file loader.
add_executable(test_texture_fb
    renderer/test_texture_fb.cpp
    ${CMAKE_SOURCE_DIR}/src/esengine/renderer/rhi/Texture.cpp
    ${CMAKE_SOURCE_DIR}/src/esengine/renderer/rhi/Framebuffer.cpp
    ${CMAKE_SOURCE_DIR}/src/esengine/core/Log.cpp
)
target_include_directories(test_texture_fb PRIVATE
    ${CMAKE_SOURCE_DIR}/src
    ${CMAKE_SOURCE_DIR}/third_party/stb
)
add_test(NAME test_texture_fb COMMAND test_texture_fb)

# Buffer + CustomGeometry decoupling: compiles the converted classes against a
# MockGfxDevice. Linking proves they contain no GL; asserts confirm create/
# upload/attribute-setup/bind/delete route through GfxDevice.
add_executable(test_buffer_device
    renderer/test_buffer_device.cpp
    ${CMAKE_SOURCE_DIR}/src/esengine/renderer/rhi/Buffer.cpp
    ${CMAKE_SOURCE_DIR}/src/esengine/renderer/draw/CustomGeometry.cpp
    ${CMAKE_SOURCE_DIR}/src/esengine/core/Log.cpp
)
target_include_directories(test_buffer_device PRIVATE ${CMAKE_SOURCE_DIR}/src)
add_test(NAME test_buffer_device COMMAND test_buffer_device)

# Device loss: the shared state machine (GfxDevice), driven through MockGfxDevice.
# Header-only, so nothing but Log.cpp is needed to link.
add_executable(test_device_loss
    renderer/test_device_loss.cpp
    ${CMAKE_SOURCE_DIR}/src/esengine/renderer/rhi/Texture.cpp
    ${CMAKE_SOURCE_DIR}/src/esengine/core/Log.cpp
)
target_include_directories(test_device_loss PRIVATE ${CMAKE_SOURCE_DIR}/src)
add_test(NAME test_device_loss COMMAND test_device_loss)

# WebGPU backend slice 1 (REARCH_WGSL Phase 2): the enum→WGPU mapping layer +
# the null-device-safe WebGPUDevice skeleton, compiled against the REAL Dawn C
# headers via the emdawnwebgpu port (emscripten-only; the port supplies
# <webgpu/webgpu.h> and its JS glue).
if(EMSCRIPTEN)
    add_executable(test_webgpu_device
        renderer/test_webgpu_device.cpp
        ${CMAKE_SOURCE_DIR}/src/esengine/renderer/webgpu/WebGPUDevice.cpp
        ${CMAKE_SOURCE_DIR}/src/esengine/core/Log.cpp
    )
    target_include_directories(test_webgpu_device PRIVATE
        ${CMAKE_SOURCE_DIR}/src
        ${CMAKE_SOURCE_DIR}/third_party/glm
    )
    target_compile_options(test_webgpu_device PRIVATE --use-port=emdawnwebgpu)
    target_link_options(test_webgpu_device PRIVATE --use-port=emdawnwebgpu)
    add_test(NAME test_webgpu_device COMMAND test_webgpu_device)
endif()

# WebGPU bring-up program (REARCH_WGSL Phase 2 slice 2): NOT a test harness — a
# browser-run wasm that renders the shape-shader WGSL twin through the real
# WebGPUDevice (surface pass + lazy pipeline + bind group + indexed draw). Driven
# by desktop/scripts/webgpu-bringup.mjs under electron, which asserts the pixels.
if(EMSCRIPTEN)
    add_executable(webgpu_bringup
        renderer/webgpu_bringup.cpp
        ${CMAKE_SOURCE_DIR}/src/esengine/renderer/webgpu/WebGPUDevice.cpp
        ${CMAKE_SOURCE_DIR}/src/esengine/core/Log.cpp
        # The twins assemble from the embedded .esshaders (WGSL target).
        ${CMAKE_SOURCE_DIR}/src/esengine/resource/ShaderParser.cpp
    )
    target_include_directories(webgpu_bringup PRIVATE
        ${CMAKE_SOURCE_DIR}/src
        ${CMAKE_SOURCE_DIR}/third_party/glm
    )
    target_compile_options(webgpu_bringup PRIVATE --use-port=emdawnwebgpu)
    target_link_options(webgpu_bringup PRIVATE --use-port=emdawnwebgpu)
endif()

# Engine-level backend parity harness (REARCH_WGSL Phase 2): the FULL engine —
# EstellaContext with every subsystem — booted on an injected backend (WebGPU
# via emdawnwebgpu, or the stock WebGL2 path, chosen by URL) rendering one ECS
# scene. Driven by desktop/scripts/engine-parity.mjs, which asserts the SAME
# pixels on both backends. WebGL2 link flags are required because the GL run
# uses the production GLES3 path.
if(EMSCRIPTEN)
    add_executable(webgpu_engine_bringup
        renderer/webgpu_engine_bringup.cpp
        ${CMAKE_SOURCE_DIR}/src/esengine/renderer/webgpu/WebGPUDevice.cpp
    )
    target_link_libraries(webgpu_engine_bringup PRIVATE esengine)
    target_compile_options(webgpu_engine_bringup PRIVATE --use-port=emdawnwebgpu)
    target_link_options(webgpu_engine_bringup PRIVATE
        --use-port=emdawnwebgpu
        -sUSE_WEBGL2=1
        -sFULL_ES3=1
        -sALLOW_MEMORY_GROWTH=1
    )
endif()

# Boundary-span validation (RC3): JS-supplied pointer+length pairs are null-,
# overflow-, and heap-range-checked ALWAYS ON. Header-only + Log.cpp; under
# emscripten the heap-range cases exercise the real linear-memory bound.
add_executable(test_boundary_span
    bindings/test_boundary_span.cpp
    ${CMAKE_SOURCE_DIR}/src/esengine/core/Log.cpp
)
target_include_directories(test_boundary_span PRIVATE ${CMAKE_SOURCE_DIR}/src)
add_test(NAME test_boundary_span COMMAND test_boundary_span)

# Unified submission face (render-pipeline unification): BatchBuilder is the single
# DrawCommand producer for every stream. Compiles BatchBuilder/DrawList/
# TransientBufferPool against the MockGfxDevice and asserts per-stream baseVertex
# math, texture-slot rules, instanced assembly, merge behavior, and execute() dispatch.
add_executable(test_batch_builder
    renderer/test_batch_builder.cpp
    ${CMAKE_SOURCE_DIR}/src/esengine/renderer/draw/BatchBuilder.cpp
    ${CMAKE_SOURCE_DIR}/src/esengine/renderer/draw/DrawList.cpp
    ${CMAKE_SOURCE_DIR}/src/esengine/renderer/rhi/TransientBufferPool.cpp
    ${CMAKE_SOURCE_DIR}/src/esengine/renderer/store/MaterialStore.cpp
    ${CMAKE_SOURCE_DIR}/src/esengine/renderer/frame/FrameCapture.cpp
    ${CMAKE_SOURCE_DIR}/src/esengine/core/Log.cpp
)
target_include_directories(test_batch_builder PRIVATE
    ${CMAKE_SOURCE_DIR}/src
    ${CMAKE_SOURCE_DIR}/third_party/glm
)
add_test(NAME test_batch_builder COMMAND test_batch_builder)

# GfxDevice compressed-texture entry (RC6-A). Header-only: drives MockGfxDevice to
# assert the compressed upload + capability-gated RGBA8 fallback. No GL, no emsdk.
add_executable(test_compressed_format
    renderer/test_compressed_format.cpp
)
target_include_directories(test_compressed_format PRIVATE ${CMAKE_SOURCE_DIR}/src)
add_test(NAME test_compressed_format COMMAND test_compressed_format)

# Log format-string precision parsing (Audit A1). Only needs Log.cpp.
# Should be compiled with exceptions OFF to mirror the engine's release config:
# proves malformed float specs like "{:.f}" no longer abort (the old std::stoi
# path threw -> abort under -fno-exceptions).
add_executable(test_log_format
    core/test_log_format.cpp
    ${CMAKE_SOURCE_DIR}/src/esengine/core/Log.cpp
)
target_include_directories(test_log_format PRIVATE ${CMAKE_SOURCE_DIR}/src)
target_compile_options(test_log_format PRIVATE -fno-exceptions)
add_test(NAME test_log_format COMMAND test_log_format)

# Registry/SparseSet release-safety (Audit A6 + A7). Header-only against
# Registry.hpp + Log.cpp (no esengine link). MUST stay free of -DES_DEBUG so
# ES_ASSERT is stripped, matching the release config where the OOB read
# (get on a non-member) and entity_count underflow (re-entrant destroy) appear.
add_executable(test_registry_safety
    ecs/test_registry_safety.cpp
    ${CMAKE_SOURCE_DIR}/src/esengine/core/Log.cpp
)
target_include_directories(test_registry_safety PRIVATE ${CMAKE_SOURCE_DIR}/src)
# Run under AddressSanitizer: the bugs this guards (emplace-on-invalid OOB write,
# over-range index alias) are memory-safety faults that only ASAN catches
# deterministically. Skipped on MSVC (different sanitizer flag syntax).
set(_es_safety_asan $<OR:$<CXX_COMPILER_ID:GNU>,$<CXX_COMPILER_ID:Clang>,$<CXX_COMPILER_ID:AppleClang>>)
target_compile_options(test_registry_safety PRIVATE $<${_es_safety_asan}:-fsanitize=address>)
target_link_options(test_registry_safety PRIVATE $<${_es_safety_asan}:-fsanitize=address>)
add_test(NAME test_registry_safety COMMAND test_registry_safety)

# onDestroy RAII Connection / dual-order teardown safety (RC12 B1, fixes A12).
# Built with AddressSanitizer so the use-after-free the old bare-`this` callback
# caused (in either teardown order) is actually caught, not just "didn't crash".
add_executable(test_registry_ondestroy
    ecs/test_registry_ondestroy.cpp
    ${CMAKE_SOURCE_DIR}/src/esengine/core/Log.cpp
)
target_include_directories(test_registry_ondestroy PRIVATE
    ${CMAKE_SOURCE_DIR}/src
    ${CMAKE_SOURCE_DIR}/third_party/glm)
target_compile_options(test_registry_ondestroy PRIVATE $<${_es_safety_asan}:-fsanitize=address>)
target_link_options(test_registry_ondestroy PRIVATE $<${_es_safety_asan}:-fsanitize=address>)
add_test(NAME test_registry_ondestroy COMMAND test_registry_ondestroy)

# Physics render interpolation. The snapshot pair and the lerp live in the physics
# module, not the SDK: they touch every dynamic body every frame, which the no-JIT
# budget keeps off the JS path (docs/REARCH_NATIVE.md §3.2). The whole module is
# compiled in because its entry TU calls into the shape/joint/query ones.
if(ES_ENABLE_BOX2D)
    add_executable(test_physics_interpolation
        bindings/test_physics_interpolation.cpp
        ${CMAKE_SOURCE_DIR}/src/esengine/bindings/modules/physics/PhysicsModuleEntry.cpp
        ${CMAKE_SOURCE_DIR}/src/esengine/bindings/modules/physics/PhysicsReadback.cpp
        ${CMAKE_SOURCE_DIR}/src/esengine/bindings/modules/physics/PhysicsContext.cpp
        ${CMAKE_SOURCE_DIR}/src/esengine/bindings/modules/physics/PhysicsShapes.cpp
        ${CMAKE_SOURCE_DIR}/src/esengine/bindings/modules/physics/PhysicsJoints.cpp
        ${CMAKE_SOURCE_DIR}/src/esengine/bindings/modules/physics/PhysicsQueries.cpp
    )
    target_link_libraries(test_physics_interpolation PRIVATE box2d)
    target_include_directories(test_physics_interpolation PRIVATE
        ${CMAKE_SOURCE_DIR}/src
        ${CMAKE_SOURCE_DIR}/third_party/box2d/include
    )
    add_test(NAME test_physics_interpolation COMMAND test_physics_interpolation)
endif()
