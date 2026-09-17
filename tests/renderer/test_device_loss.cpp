// Device loss: a lost device cannot be half-alive, every handle survives the loss,
// each content policy comes back as promised, and the device turns Live exactly
// when nothing is owed. Per-backend guards: test_webgpu_device.cpp.

#include "MockGfxDevice.hpp"
#include "esengine/renderer/rhi/GfxEnums.hpp"
#include "esengine/renderer/rhi/Texture.hpp"

#include <cstdio>
#include <string>

using namespace esengine;

static int g_failures = 0;
#define CHECK(cond, msg)                                                        \
    do {                                                                        \
        if (!(cond)) { std::printf("FAIL: %s\n", msg); ++g_failures; }          \
        else { std::printf("ok:   %s\n", msg); }                                \
    } while (0)

int main() {
    // --- A live device reports nothing ---
    {
        MockGfxDevice d;
        CHECK(d.deviceStatus() == GfxDeviceStatus::Live, "a new device is Live");
        CHECK(d.isDeviceLive(), "isDeviceLive agrees");
        CHECK(d.deviceLostInfo() == nullptr, "a live device has no loss report");
        CHECK(d.beginDeviceFrame(), "a live device opens a frame");
    }

    // --- The transition, and its report ---
    {
        MockGfxDevice d;
        d.setDeviceIdentity("WebGL2", "Acme", "Acme GPU 9000", "4.2-driver");

        int handlerCalls = 0;
        GfxDeviceLostInfo seen{};
        d.setDeviceLostHandler([&](const GfxDeviceLostInfo& info) {
            ++handlerCalls;
            seen = info;
        });

        d.beginDeviceFrame();
        d.beginDeviceFrame();
        d.notifyDeviceLost(GfxDeviceLostReason::OutOfMemory, "allocation failed", "createTexture");

        CHECK(d.deviceStatus() == GfxDeviceStatus::Lost, "notifyDeviceLost moves it to Lost");
        CHECK(!d.isDeviceLive(), "a lost device is not live");
        CHECK(handlerCalls == 1, "the handler fires once");
        CHECK(seen.reason == GfxDeviceLostReason::OutOfMemory, "the reason is carried through");
        CHECK(seen.message == "allocation failed", "the driver message is carried through");
        CHECK(seen.context == "createTexture", "what it was doing is carried through");
        CHECK(seen.frame == 2, "the loss is stamped with the frame it happened on");

        // The identity was captured at init, when the backend could still answer.
        const std::string report = gfxFormatDeviceLost(seen);
        CHECK(report.find("out-of-memory") != std::string::npos, "the report names the reason");
        CHECK(report.find("WebGL2") != std::string::npos, "the report names the backend");
        CHECK(report.find("Acme GPU 9000") != std::string::npos, "the report names the GPU");
        CHECK(report.find("4.2-driver") != std::string::npos, "the report names the driver");
        CHECK(report.find("createTexture") != std::string::npos, "the report says what was running");
    }

    // --- A lost device stays lost, with its FIRST explanation ---
    {
        MockGfxDevice d;
        int handlerCalls = 0;
        d.setDeviceLostHandler([&](const GfxDeviceLostInfo&) { ++handlerCalls; });

        d.notifyDeviceLost(GfxDeviceLostReason::Reset, "gpu hang");
        d.notifyDeviceLost(GfxDeviceLostReason::Validation, "a later, derived failure");

        CHECK(handlerCalls == 1, "a second loss does not re-report");
        CHECK(d.deviceLostInfo() != nullptr, "the report survives");
        CHECK(d.deviceLostInfo()->reason == GfxDeviceLostReason::Reset,
              "the first reason wins — it is the one that explains the rest");
        CHECK(!d.beginDeviceFrame(), "a lost device refuses to open a frame");
    }

    // --- Giving up is a state, not a silence ---
    {
        MockGfxDevice d;
        d.markDeviceDead();
        CHECK(d.deviceStatus() == GfxDeviceStatus::Dead, "markDeviceDead on a live device ends it");
        CHECK(d.deviceLostInfo() != nullptr, "a dead device still carries a report");
        CHECK(!d.beginDeviceFrame(), "a dead device refuses to open a frame");

        MockGfxDevice d2;
        d2.notifyDeviceLost(GfxDeviceLostReason::Removed, "adapter gone");
        d2.markDeviceDead();
        CHECK(d2.deviceStatus() == GfxDeviceStatus::Dead, "a lost device can be given up on");
        CHECK(d2.deviceLostInfo()->reason == GfxDeviceLostReason::Removed,
              "giving up does not overwrite why it was lost");
    }

    // --- A recovery with nothing owed is whole at once ---
    {
        MockGfxDevice d;
        const std::vector<u8> bytes(16, 7);
        const BufferHandle kept = d.createBuffer({GfxBufferUsage::Uniform, 16, true},
                                                 GfxContent::retained(), bytes.data());
        const u64 generation = d.deviceGeneration();
        d.notifyDeviceLost(GfxDeviceLostReason::ContextLost, "gone");

        CHECK(d.recoverDevice(), "recoverDevice succeeds when the backend can rebuild");
        CHECK(d.recreateCalls == 1, "the backend was asked exactly once");
        CHECK(d.deviceGeneration() == generation + 1, "a rebuild is a new generation");
        CHECK(d.deviceStatus() == GfxDeviceStatus::Live, "nothing owed: Live straight away");
        CHECK(d.deviceLostInfo() == nullptr, "a whole device reports no loss");
        CHECK(d.identityCaptures == 1, "a rebuilt device can be another GPU, so it is asked again");
        CHECK(d.bufferDesc(kept) != nullptr, "the handle names the same buffer");
        CHECK(d.lastCreateBufferBytes == bytes, "retained bytes are uploaded again");

        CHECK(d.recoverDevice(), "asking again is a no-op that reports usable");
        CHECK(d.recreateCalls == 1, "and does not rebuild twice");
    }

    // --- Sourced content is owed until a whole upload pays it ---
    {
        MockGfxDevice d;
        TextureDesc desc;
        desc.width = 4;
        desc.height = 4;
        const TextureHandle sourced = d.createTexture(desc, GfxContent::sourced(2, 17), nullptr);
        const TextureHandle transient = d.createTexture(desc, GfxContent::transient(), nullptr);
        d.notifyDeviceLost(GfxDeviceLostReason::ContextLost, "gone");
        d.recoverDevice();

        CHECK(d.deviceStatus() == GfxDeviceStatus::Recovering, "owed content keeps it Recovering");
        CHECK(d.isDeviceUsable() && d.beginDeviceFrame(), "a Recovering device draws meanwhile");
        const auto owed = d.owedContent();
        CHECK(owed.size() == 1 && owed[0].id == static_cast<u32>(sourced),
              "the ledger holds the sourced texture and not the transient one");
        CHECK(owed.size() == 1 && owed[0].provider == 2 && owed[0].key == 17,
              "the entry names its provider and key");
        CHECK(d.textureDesc(transient) != nullptr, "the transient texture came back as storage");

        const std::vector<u8> half(2 * 4 * 4, 1);
        d.updateTexture(sourced, 0, 0, 2, 4, half.data(), false);
        CHECK(d.deviceStatus() == GfxDeviceStatus::Recovering, "a partial upload pays nothing");

        const std::vector<u8> whole(4 * 4 * 4, 1);
        d.updateTexture(sourced, 0, 0, 4, 4, whole.data(), false);
        CHECK(d.owedContent().empty(), "a whole upload pays the debt");
        CHECK(d.deviceStatus() == GfxDeviceStatus::Live, "and the device turns Live by itself");
    }

    // --- Forgoing and deleting settle a debt nobody will pay ---
    {
        MockGfxDevice d;
        TextureDesc desc;
        desc.width = 2;
        desc.height = 2;
        d.createTexture(desc, GfxContent::sourced(3, 0), nullptr);
        const TextureHandle deleted = d.createTexture(desc, GfxContent::sourced(4, 0), nullptr);
        d.notifyDeviceLost(GfxDeviceLostReason::ContextLost, "gone");
        d.recoverDevice();

        CHECK(d.owedContent().size() == 2, "both are owed");
        d.deleteTexture(deleted);
        CHECK(d.owedContent().size() == 1, "a deleted texture owes nothing");
        d.forgoContent(d.owedContent()[0]);
        CHECK(d.deviceStatus() == GfxDeviceStatus::Live, "a forgone debt settles recovery");
    }

    // --- Every kind of object comes back behind the handle it had ---
    {
        MockGfxDevice d;
        const BufferHandle vertices = d.createBuffer({GfxBufferUsage::Vertex, 8, true},
                                                     GfxContent::transient(), nullptr);
        TextureDesc desc;
        desc.width = 8;
        desc.height = 8;
        const TextureHandle color = d.createTexture(desc, GfxContent::transient(), nullptr);
        const FramebufferHandle target = d.createFramebuffer({color, TextureHandle::Invalid});
        const ShaderHandle program = d.createProgram({GfxShaderLanguage::GLSL_ES300, "vs", "fs"},
                                                     nullptr, 0, nullptr, nullptr);
        const GfxLiveObjects before = d.liveObjects();
        const int buffersMade = d.createBufferCalls;
        const int texturesMade = d.createTextureCalls;
        const int framebuffersMade = d.createFramebufferCalls;
        const int programsMade = d.createProgramCalls;

        d.notifyDeviceLost(GfxDeviceLostReason::ContextLost, "gone");
        d.recoverDevice();

        CHECK(d.bufferDesc(vertices) && d.textureDesc(color) && d.framebufferDesc(target),
              "buffer, texture and framebuffer handles still resolve");
        CHECK(d.createBufferCalls == buffersMade + 1 && d.createTextureCalls == texturesMade + 1
                  && d.createFramebufferCalls == framebuffersMade + 1
                  && d.createProgramCalls == programsMade + 1,
              "each was built once more on the new device");
        CHECK(!d.lastCreateBufferHadData, "transient storage comes back without contents");
        const GfxLiveObjects after = d.liveObjects();
        CHECK(after.buffers == before.buffers && after.textures == before.textures
                  && after.programs == before.programs && after.renderTargets == before.renderTargets,
              "a recovery adds no objects");
        (void)program;
    }

    // --- A program's state is replayed after the relink ---
    {
        MockGfxDevice d;
        d.blockIndexAnswer = 3;
        const ShaderHandle program = d.createProgram({GfxShaderLanguage::GLSL_ES300, "vs", "fs"},
                                                     nullptr, 0, nullptr, nullptr);
        d.useProgram(program);
        const i32 sampler = d.getUniformLocation(program, "u_texture");
        d.setUniform1i(sampler, 5);
        d.uniformBlockBinding(program, d.getUniformBlockIndex(program, "FrameConstants"), 2);
        const int intsSet = d.setUniform1iCalls;
        d.blockBindingLog.clear();

        d.notifyDeviceLost(GfxDeviceLostReason::ContextLost, "gone");
        d.recoverDevice();

        CHECK(d.setUniform1iCalls == intsSet + 1 && d.lastUniform1iVal == 5,
              "the sampler unit is set again on the new program");
        CHECK(d.blockBindingLog.size() == 1 && d.blockBindingLog[0].second == 2,
              "the block binding is replayed");
        CHECK(d.getUniformLocation(program, "u_texture") == sampler,
              "a location handed out stays the location");
    }

    // --- Objects created while lost are realized by the recovery ---
    {
        MockGfxDevice d;
        d.notifyDeviceLost(GfxDeviceLostReason::ContextLost, "gone");
        const std::vector<u8> bytes(8, 9);
        const int made = d.createBufferCalls;
        const BufferHandle late = d.createBuffer({GfxBufferUsage::Vertex, 8, false},
                                                 GfxContent::transient(), bytes.data());
        CHECK(late != BufferHandle::Invalid, "a lost device still issues a handle");
        CHECK(d.createBufferCalls == made, "and touches no backend");
        d.recoverDevice();
        CHECK(d.createBufferCalls == made + 1 && d.lastCreateBufferBytes == bytes,
              "the recovery builds it with the bytes it was created with");
    }

    // --- Losing the device again mid-recovery starts the transaction over ---
    {
        MockGfxDevice d;
        TextureDesc desc;
        desc.width = 2;
        desc.height = 2;
        const std::vector<u8> pixels(16, 200);
        d.createTexture(desc, GfxContent::sourced(2, 0), nullptr);
        const TextureHandle kept = d.createTexture(desc, GfxContent::retained(), pixels.data());
        d.notifyDeviceLost(GfxDeviceLostReason::ContextLost, "first");
        d.recoverDevice();
        CHECK(d.deviceStatus() == GfxDeviceStatus::Recovering, "recovering from the first loss");

        d.notifyDeviceLost(GfxDeviceLostReason::ContextLost, "second");
        CHECK(d.deviceStatus() == GfxDeviceStatus::Lost, "a loss while Recovering is a loss");
        CHECK(d.owedContent().empty(), "nothing is owed by a device that has no storage");
        d.recoverDevice();
        CHECK(d.recreateCalls == 2, "the second loss is rebuilt too");
        CHECK(d.owedContent().size() == 1, "the ledger is counted afresh");
        CHECK(d.textureDesc(kept) != nullptr && d.lastCreateTextureBytes.size() == pixels.size(),
              "retained pixels come back through both losses");
    }

    // --- A provider pays by handing over a texture it loaded ---
    {
        MockGfxDevice d;
        TextureSpecification spec;
        spec.width = 4;
        spec.height = 4;
        spec.format = TextureFormat::RGBA8;
        auto owedTexture = Texture::create(d, GfxContent::sourced(2, 0), spec);
        d.notifyDeviceLost(GfxDeviceLostReason::ContextLost, "gone");
        d.recoverDevice();
        const TextureHandle handle = owedTexture->handle();

        spec.width = 8;
        auto fresh = Texture::create(d, GfxContent::sourced(2, 0), spec);
        CHECK(owedTexture->adoptContent(*fresh), "the fresh texture's pixels move behind the owed handle");
        CHECK(owedTexture->handle() == handle, "the owed texture keeps its handle");
        CHECK(owedTexture->getWidth() == 8 && d.textureDesc(handle)->width == 8,
              "and takes the size it was loaded at");
        CHECK(fresh->handle() == TextureHandle::Invalid, "the provider's texture is empty afterwards");
        CHECK(d.deviceStatus() == GfxDeviceStatus::Live, "the debt is paid");
        CHECK(d.liveObjects().textures == 1, "one texture, not two");
    }

    // --- A recovery that fails leaves it retryable, not half-open ---
    {
        MockGfxDevice d;
        d.notifyDeviceLost(GfxDeviceLostReason::Reset, "hung");
        d.recreateSucceeds = false;

        CHECK(!d.recoverDevice(), "recoverDevice reports the failure");
        CHECK(d.deviceStatus() == GfxDeviceStatus::Lost, "a failed recovery falls back to Lost");
        CHECK(!d.isDeviceUsable(), "and nothing may be submitted to it");
        CHECK(d.deviceLostInfo()->reason == GfxDeviceLostReason::Reset,
              "the original reason is not lost to the failed attempt");

        // Retryable: a context comes back when the browser is ready, not when asked.
        d.recreateSucceeds = true;
        CHECK(d.recoverDevice(), "a later attempt can still succeed");
        CHECK(d.isDeviceLive(), "and with nothing owed it is whole");
    }

    // --- The transitions that must do nothing ---
    {
        MockGfxDevice live;
        CHECK(live.recoverDevice(), "recovering a live device is a no-op that reports usable");
        CHECK(live.recreateCalls == 0, "a live device is never asked to rebuild");
        CHECK(live.identityCaptures == 0, "and does not re-ask its identity");

        MockGfxDevice dead;
        dead.markDeviceDead();
        CHECK(!dead.recoverDevice(), "a device given up on is not recovered");
        CHECK(dead.recreateCalls == 0, "and its backend is never asked");
        CHECK(dead.deviceStatus() == GfxDeviceStatus::Dead, "it stays Dead");
    }

    std::printf(g_failures ? "\n%d FAILURE(S)\n" : "\nall passed\n", g_failures);
    return g_failures ? 1 : 0;
}
