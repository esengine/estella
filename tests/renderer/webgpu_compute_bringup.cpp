// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  WebGPU compute bring-up — NOT a doctest harness.
 *
 * A browser-run program: the host page acquires a GPUDevice (navigator.gpu) and hands it over via
 * Module.preinitializedWebGPUDevice; this program then drives the REAL WebGPUDevice through the compute half of the RHI —
 * createCompute / dispatchCompute and the readbacks that bring a storage buffer or texture back — and checks the numbers
 * the GPU computed:
 *   buffers   a uniform, a read-only and a read-write storage buffer in one dispatch; a second dispatch with other
 *             parameters through the cached pipeline
 *   texture   a compute-written RGBA8 and RGBA32F storage texture, read back whole
 *   sampling  a sampled texture read with textureLoad, and with a linear sampler between texels
 *   refusals  a dispatch inside a render pass runs nothing; a buffer not made for the binding is refused
 * It prints `COMPUTE_CHECK <name> ok|FAIL …` per case and `COMPUTE_DONE failures=N`; the runner
 * (desktop/scripts/webgpu-compute-bringup.mjs) asserts them and surfaces device validation errors.
 */
#include "esengine/renderer/webgpu/WebGPUDevice.hpp"

#include <emscripten.h>
#include <emscripten/html5.h>

#include <cmath>
#include <cstdlib>
#include <cstdio>
#include <cstring>
#include <functional>
#include <string>
#include <vector>

using namespace esengine;

namespace {

WebGPUDevice* g_device = nullptr;
int g_failures = 0;

struct Pending {
    std::string name;
    ReadbackHandle handle;
    u32 bytes;
    std::function<std::string(const u8*)> verify;  // empty = ok, else why not
};
std::vector<Pending> g_pending;

void report(const std::string& name, const std::string& why) {
    if (why.empty()) {
        std::printf("COMPUTE_CHECK %s ok\n", name.c_str());
    } else {
        ++g_failures;
        std::printf("COMPUTE_CHECK %s FAIL %s\n", name.c_str(), why.c_str());
    }
}

void expect(const std::string& name, bool cond, const std::string& why) { report(name, cond ? "" : why); }

void later(const std::string& name, ReadbackHandle handle, u32 bytes, std::function<std::string(const u8*)> verify) {
    if (handle == ReadbackHandle::Invalid) {
        report(name, "the readback was refused");
        return;
    }
    g_pending.push_back({name, handle, bytes, std::move(verify)});
}

void pump() {
    for (usize i = 0; i < g_pending.size();) {
        Pending& p = g_pending[i];
        const GfxReadbackStatus status = g_device->pollReadback(p.handle);
        if (status == GfxReadbackStatus::Pending) { ++i; continue; }
        if (status == GfxReadbackStatus::Failed) {
            report(p.name, "the readback failed");
        } else {
            std::vector<u8> bytes(p.bytes);
            if (!g_device->takeReadback(p.handle, bytes.data(), bytes.size())) {
                report(p.name, "takeReadback refused");
            } else {
                report(p.name, p.verify(bytes.data()));
            }
        }
        g_pending.erase(g_pending.begin() + static_cast<long>(i));
    }
    if (g_pending.empty()) {
        std::printf("COMPUTE_DONE failures=%d\n", g_failures);
        emscripten_cancel_main_loop();
    }
}

const char* kBufferShader = R"(
struct Params { add : u32, n : u32, pad0 : u32, pad1 : u32 };
@group(0) @binding(0) var<uniform> params : Params;
@group(0) @binding(1) var<storage, read> src : array<u32>;
@group(0) @binding(2) var<storage, read_write> dst : array<u32>;
@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id : vec3u) {
    if (id.x >= params.n) { return; }
    dst[id.x] = src[id.x] * 2u + params.add;
}
)";

const char* kTextureShader = R"(
@group(0) @binding(0) var out : texture_storage_2d<rgba8unorm, write>;
@compute @workgroup_size(8, 8) fn main(@builtin(global_invocation_id) id : vec3u) {
    textureStore(out, vec2i(id.xy), vec4f(f32(id.x) / 7.0, f32(id.y) / 7.0, 0.5, 1.0));
}
)";

const char* kFloatShader = R"(
@group(0) @binding(0) var out : texture_storage_2d<rgba32float, write>;
@compute @workgroup_size(4, 4) fn main(@builtin(global_invocation_id) id : vec3u) {
    textureStore(out, vec2i(id.xy), vec4f(f32(id.x), f32(id.y), f32(id.x * id.y), 1.0));
}
)";

const char* kLoadShader = R"(
@group(0) @binding(0) var src : texture_2d<f32>;
@group(0) @binding(1) var<storage, read_write> dst : array<u32>;
@compute @workgroup_size(4, 2) fn main(@builtin(global_invocation_id) id : vec3u) {
    let c = textureLoad(src, vec2i(id.xy), 0);
    dst[id.y * 4u + id.x] = pack4x8unorm(c);
}
)";

const char* kSampleShader = R"(
@group(0) @binding(0) var src : texture_2d<f32>;
@group(0) @binding(1) var samp : sampler;
@group(0) @binding(2) var<storage, read_write> dst : array<f32>;
@compute @workgroup_size(1) fn main() {
    // The centre of a 2x2 texture is half way between all four texels.
    let c = textureSampleLevel(src, samp, vec2f(0.5, 0.5), 0.0);
    dst[0] = c.r;
    dst[1] = c.g;
    dst[2] = c.b;
    dst[3] = c.a;
}
)";

ComputeHandle compile(const char* source, const char* name) {
    std::string log;
    ComputeHandle h = g_device->createCompute(GfxComputeSource{GfxShaderLanguage::WGSL, source, "main"}, &log);
    if (h == ComputeHandle::Invalid) {
        ++g_failures;
        std::printf("COMPUTE_CHECK %s FAIL could not create the program: %s\n", name, log.c_str());
    }
    return h;
}

std::string diff(const char* what, i64 got, i64 want) {
    return std::string(what) + " is " + std::to_string(got) + ", expected " + std::to_string(want);
}

void runBuffers() {
    constexpr u32 N = 1000;
    ComputeHandle program = compile(kBufferShader, "buffers");
    if (program == ComputeHandle::Invalid) return;

    std::vector<u32> src(N);
    for (u32 i = 0; i < N; ++i) src[i] = i * 3;
    struct Params { u32 add, n, pad0, pad1; };
    BufferHandle srcBuf = g_device->createBuffer({GfxBufferUsage::Storage, N * 4, false}, GfxContent::retained(), src.data());
    BufferHandle dstBuf = g_device->createBuffer({GfxBufferUsage::Storage, N * 4, false}, GfxContent::transient(), nullptr);
    Params params{7, N, 0, 0};
    BufferHandle paramBuf = g_device->createBuffer({GfxBufferUsage::Uniform, sizeof(Params), false}, GfxContent::retained(), &params);

    const GfxComputeBinding bindings[3] = {
        GfxComputeBinding::uniform(0, paramBuf),
        GfxComputeBinding::storageRead(1, srcBuf),
        GfxComputeBinding::storage(2, dstBuf),
    };
    g_device->setAsyncComputeEnabled(true);
    expect("browser has one GPU queue", !g_device->supportsAsyncCompute(), "reported an independent queue");
    expect("inline compute job opened", g_device->beginAsyncComputeJob(), "job scope refused");
    expect("buffers dispatch", g_device->dispatchCompute(program, bindings, 3, (N + 63) / 64), "dispatchCompute returned false");
    const auto fence = g_device->endAsyncComputeJob();
    expect("inline dispatch needs no fence", fence == kNoAsyncComputeFence, "received a hardware fence");
    g_device->graphicsWaitOnAsyncComputeJob(fence);
    later("buffers result", g_device->requestBufferReadback(dstBuf, 0, N * 4), N * 4, [](const u8* bytes) -> std::string {
        const u32* out = reinterpret_cast<const u32*>(bytes);
        for (u32 i = 0; i < N; ++i) {
            if (out[i] != i * 3 * 2 + 7) return diff(("dst[" + std::to_string(i) + "]").c_str(), out[i], i * 3 * 2 + 7);
        }
        return "";
    });

    // The same program again, other parameters and a slice of the buffer: the layout and pipeline come from the cache.
    params.add = 100;
    g_device->updateBuffer(paramBuf, 0, &params, sizeof(params));
    expect("buffers second dispatch", g_device->dispatchCompute(program, bindings, 3, (N + 63) / 64), "dispatchCompute returned false");
    later("buffers second result", g_device->requestBufferReadback(dstBuf, 40, 16), 16, [](const u8* bytes) -> std::string {
        const u32* out = reinterpret_cast<const u32*>(bytes);
        for (u32 i = 0; i < 4; ++i) {
            const u32 index = 10 + i;
            if (out[i] != index * 3 * 2 + 100) return diff(("dst[" + std::to_string(index) + "]").c_str(), out[i], index * 3 * 2 + 100);
        }
        return "";
    });

    // Refusals: a zero group count, and a uniform bound where a storage buffer is declared.
    expect("zero groups refused", !g_device->dispatchCompute(program, bindings, 3, 0), "a dispatch of no groups ran");
    const GfxComputeBinding wrong[3] = {
        GfxComputeBinding::uniform(0, paramBuf),
        GfxComputeBinding::storageRead(1, paramBuf),  // a uniform buffer where storage is bound
        GfxComputeBinding::storage(2, dstBuf),
    };
    expect("wrong buffer refused", !g_device->dispatchCompute(program, wrong, 3, 1), "a buffer not made for storage was bound as storage");
}

void runTextures() {
    ComputeHandle program = compile(kTextureShader, "texture");
    if (program != ComputeHandle::Invalid) {
        TextureDesc td{};
        td.width = 8;
        td.height = 8;
        td.format = GfxPixelFormat::RGBA8;
        td.storage = true;
        td.minFilter = td.magFilter = TextureFilter::Nearest;
        TextureHandle tex = g_device->createTexture(td, GfxContent::transient(), nullptr);
        const GfxComputeBinding bindings[1] = {GfxComputeBinding::storageTexture(0, tex)};
        expect("texture dispatch", g_device->dispatchCompute(program, bindings, 1, 1, 1), "dispatchCompute returned false");
        later("texture result", g_device->requestTextureReadback(tex), 8 * 8 * 4, [](const u8* bytes) -> std::string {
            for (u32 y = 0; y < 8; ++y) {
                for (u32 x = 0; x < 8; ++x) {
                    const u8* p = bytes + (y * 8 + x) * 4;
                    const int wantR = static_cast<int>(std::lround(x / 7.0 * 255.0));
                    const int wantG = static_cast<int>(std::lround(y / 7.0 * 255.0));
                    if (std::abs(p[0] - wantR) > 1 || std::abs(p[1] - wantG) > 1 || std::abs(p[2] - 128) > 1 || p[3] != 255) {
                        return "texel (" + std::to_string(x) + "," + std::to_string(y) + ") is " + std::to_string(p[0]) + "," +
                               std::to_string(p[1]) + "," + std::to_string(p[2]) + "," + std::to_string(p[3]);
                    }
                }
            }
            return "";
        });

        // A texture made without storage cannot be bound as one.
        TextureDesc plain = td;
        plain.storage = false;
        TextureHandle plainTex = g_device->createTexture(plain, GfxContent::transient(), nullptr);
        const GfxComputeBinding refused[1] = {GfxComputeBinding::storageTexture(0, plainTex)};
        expect("plain texture refused", !g_device->dispatchCompute(program, refused, 1, 1, 1), "a texture without storage was bound as storage");
    }

    ComputeHandle floats = compile(kFloatShader, "float texture");
    if (floats != ComputeHandle::Invalid) {
        TextureDesc td{};
        td.width = 4;
        td.height = 4;
        td.format = GfxPixelFormat::RGBA32F;
        td.storage = true;
        td.minFilter = td.magFilter = TextureFilter::Nearest;
        TextureHandle tex = g_device->createTexture(td, GfxContent::transient(), nullptr);
        const GfxComputeBinding bindings[1] = {GfxComputeBinding::storageTexture(0, tex)};
        expect("float dispatch", g_device->dispatchCompute(floats, bindings, 1, 1, 1), "dispatchCompute returned false");
        later("float result", g_device->requestTextureReadback(tex), 4 * 4 * 16, [](const u8* bytes) -> std::string {
            const f32* f = reinterpret_cast<const f32*>(bytes);
            for (u32 y = 0; y < 4; ++y) {
                for (u32 x = 0; x < 4; ++x) {
                    const f32* p = f + (y * 4 + x) * 4;
                    if (p[0] != static_cast<f32>(x) || p[1] != static_cast<f32>(y) || p[2] != static_cast<f32>(x * y) || p[3] != 1.0f) {
                        return "texel (" + std::to_string(x) + "," + std::to_string(y) + ") is " + std::to_string(p[0]) + "," +
                               std::to_string(p[1]) + "," + std::to_string(p[2]) + "," + std::to_string(p[3]);
                    }
                }
            }
            return "";
        });
    }
}

void runSampling() {
    // 4x2 RGBA8 with a distinct value in every channel of every texel.
    u8 pixels[4 * 2 * 4];
    for (u32 i = 0; i < 8; ++i) {
        pixels[i * 4 + 0] = static_cast<u8>(10 + i * 20);
        pixels[i * 4 + 1] = static_cast<u8>(250 - i * 20);
        pixels[i * 4 + 2] = static_cast<u8>(i * 30);
        pixels[i * 4 + 3] = static_cast<u8>(255 - i * 5);
    }
    TextureDesc td{};
    td.width = 4;
    td.height = 2;
    td.format = GfxPixelFormat::RGBA8;
    td.minFilter = td.magFilter = TextureFilter::Nearest;
    TextureHandle tex = g_device->createTexture(td, GfxContent::retained(), pixels);

    ComputeHandle load = compile(kLoadShader, "textureLoad");
    if (load != ComputeHandle::Invalid) {
        BufferHandle dst = g_device->createBuffer({GfxBufferUsage::Storage, 8 * 4, false}, GfxContent::transient(), nullptr);
        const GfxComputeBinding bindings[2] = {GfxComputeBinding::sampled(0, tex), GfxComputeBinding::storage(1, dst)};
        expect("textureLoad dispatch", g_device->dispatchCompute(load, bindings, 2, 1, 1), "dispatchCompute returned false");
        std::vector<u8> expected(pixels, pixels + sizeof(pixels));
        later("textureLoad result", g_device->requestBufferReadback(dst, 0, 8 * 4), 8 * 4, [expected](const u8* bytes) -> std::string {
            for (u32 i = 0; i < 32; ++i) {
                if (bytes[i] != expected[i]) return diff(("byte " + std::to_string(i)).c_str(), bytes[i], expected[i]);
            }
            return "";
        });
    }

    // Linear sampling at the centre of a 2x2: the mean of the four.
    const u8 corners[2 * 2 * 4] = {255, 0, 0, 255,  0, 255, 0, 255,  0, 0, 255, 255,  255, 255, 255, 255};
    TextureDesc linear{};
    linear.width = 2;
    linear.height = 2;
    linear.format = GfxPixelFormat::RGBA8;
    linear.minFilter = linear.magFilter = TextureFilter::Linear;
    TextureHandle small = g_device->createTexture(linear, GfxContent::retained(), corners);
    ComputeHandle sample = compile(kSampleShader, "textureSampleLevel");
    if (sample != ComputeHandle::Invalid) {
        BufferHandle dst = g_device->createBuffer({GfxBufferUsage::Storage, 16, false}, GfxContent::transient(), nullptr);
        const GfxComputeBinding bindings[3] = {
            GfxComputeBinding::sampled(0, small), GfxComputeBinding::sampler(1, TextureFilter::Linear), GfxComputeBinding::storage(2, dst),
        };
        expect("sampler dispatch", g_device->dispatchCompute(sample, bindings, 3, 1, 1), "dispatchCompute returned false");
        later("sampler result", g_device->requestBufferReadback(dst, 0, 16), 16, [](const u8* bytes) -> std::string {
            const f32* f = reinterpret_cast<const f32*>(bytes);
            const f32 want[4] = {0.5f, 0.5f, 0.5f, 1.0f};
            for (int i = 0; i < 4; ++i) {
                if (std::fabs(f[i] - want[i]) > 0.01f) return "channel " + std::to_string(i) + " is " + std::to_string(f[i]) + ", expected " + std::to_string(want[i]);
            }
            return "";
        });
    }
}

void runInsideRenderPass() {
    ComputeHandle program = compile(kTextureShader, "inside a pass");
    if (program == ComputeHandle::Invalid) return;
    TextureDesc td{};
    td.width = 8;
    td.height = 8;
    td.format = GfxPixelFormat::RGBA8;
    td.storage = true;
    TextureHandle storageTex = g_device->createTexture(td, GfxContent::transient(), nullptr);
    TextureDesc target{};
    target.width = 4;
    target.height = 4;
    target.format = GfxPixelFormat::RGBA8;
    TextureHandle color = g_device->createTexture(target, GfxContent::transient(), nullptr);
    FramebufferDesc fb{};
    fb.color0 = color;
    FramebufferHandle fbo = g_device->createFramebuffer(fb);
    RenderPassDesc pass{};
    pass.target = fbo;
    pass.clearColor = true;
    g_device->beginRenderPass(pass);
    expect("no compute job inside a render pass", !g_device->beginAsyncComputeJob(), "job opened inside a render pass");
    const GfxComputeBinding bindings[1] = {GfxComputeBinding::storageTexture(0, storageTex)};
    const bool ran = g_device->dispatchCompute(program, bindings, 1, 1, 1);
    g_device->endRenderPass();
    expect("no dispatch inside a render pass", !ran, "a dispatch ran inside a render pass");
    // And once the pass is over it runs again.
    expect("dispatch after the pass", g_device->dispatchCompute(program, bindings, 1, 1, 1), "dispatchCompute returned false after the pass");
}

}  // namespace

int main() {
    WGPUDevice raw = emscripten_webgpu_get_device();
    if (!raw) {
        std::printf("COMPUTE_FAIL no preinitialized device\n");
        return 1;
    }
    static WebGPUDevice device(raw);
    g_device = &device;
    if (!device.supportsCompute()) {
        std::printf("COMPUTE_FAIL the device reports no compute\n");
        return 1;
    }
    std::printf("COMPUTE_INIT_OK\n");

    runBuffers();
    runTextures();
    runSampling();
    runInsideRenderPass();
    emscripten_set_main_loop(pump, 0, /*simulate_infinite_loop=*/false);
    return 0;
}
