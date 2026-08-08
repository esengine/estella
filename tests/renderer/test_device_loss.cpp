// Device loss: the state machine every backend shares.
//
// Under test is that a lost device cannot be half-alive: the frame stops opening
// and the report names the GPU. Per-backend guards: test_webgpu_device.cpp.

#include "MockGfxDevice.hpp"
#include "esengine/renderer/rhi/GfxEnums.hpp"
#include "esengine/renderer/rhi/Texture.hpp"
#include "esengine/resource/ResourcePool.hpp"

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

    // --- Recovery: usable before it is whole ---
    {
        MockGfxDevice d;
        d.notifyDeviceLost(GfxDeviceLostReason::ContextLost, "gone");

        CHECK(d.recoverDevice(), "recoverDevice succeeds when the backend can rebuild");
        CHECK(d.recreateCalls == 1, "the backend was asked exactly once");
        CHECK(d.deviceStatus() == GfxDeviceStatus::Recovering, "a rebuilt device is Recovering");
        CHECK(!d.isDeviceLive(), "Recovering is not yet Live");
        // The whole point of the middle state: the device draws while its content
        // is still being re-uploaded, instead of freezing until the last texture.
        CHECK(d.isDeviceUsable(), "a Recovering device may be submitted to");
        CHECK(d.beginDeviceFrame(), "a Recovering device opens frames");
        CHECK(d.deviceLostInfo() != nullptr, "the report stands until the content is back");

        d.markDeviceRestored();
        CHECK(d.deviceStatus() == GfxDeviceStatus::Live, "markDeviceRestored completes it");
        CHECK(d.deviceLostInfo() == nullptr, "a restored device reports no loss");
        // A rebuilt device can be a different GPU, so the identity is re-asked.
        CHECK(d.identityCaptures == 1, "identity is captured again on restore");
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
        CHECK(d.deviceStatus() == GfxDeviceStatus::Recovering, "and it lands in Recovering");
    }

    // --- The transitions that must do nothing ---
    {
        MockGfxDevice live;
        CHECK(live.recoverDevice(), "recovering a live device is a no-op that reports usable");
        CHECK(live.recreateCalls == 0, "a live device is never asked to rebuild");
        live.markDeviceRestored();
        CHECK(live.deviceStatus() == GfxDeviceStatus::Live, "restoring a live device changes nothing");
        CHECK(live.identityCaptures == 0, "and does not re-ask its identity");

        MockGfxDevice dead;
        dead.markDeviceDead();
        CHECK(!dead.recoverDevice(), "a device given up on is not recovered");
        CHECK(dead.recreateCalls == 0, "and its backend is never asked");
        CHECK(dead.deviceStatus() == GfxDeviceStatus::Dead, "it stays Dead");
    }

    // --- The identity that survives the loss ---
    //
    // The recovery design rests on this: a pool handle names the Texture, not the
    // GPU object, so re-uploading behind it is invisible to every holder.
    {
        MockGfxDevice d;
        resource::ResourcePool<Texture> pool;

        auto first = Texture::createFromExternalId(d, 41, 64, 64, TextureFormat::RGBA8);
        auto second = Texture::createFromExternalId(d, 42, 32, 32, TextureFormat::RGBA8);
        const resource::Handle<Texture> hA = pool.add(std::move(first));
        const resource::Handle<Texture> hB = pool.add(std::move(second));
        CHECK(pool.get(hA)->handle() == static_cast<TextureHandle>(41u),
              "a texture starts on the GPU object it was registered with");

        // A loss: every live texture is swept onto a placeholder.
        const auto placeholder = static_cast<TextureHandle>(999u);
        int swept = 0;
        pool.forEachAlive([&](resource::Handle<Texture>, Texture& texture) {
            texture.retarget(placeholder, /*owns=*/false);
            ++swept;
        });
        CHECK(swept == 2, "forEachAlive reaches every live texture, path or no path");
        CHECK(pool.get(hA)->handle() == placeholder, "sampling falls back to the placeholder");
        CHECK(pool.get(hB)->handle() == placeholder, "for all of them");

        // The re-upload: a NEW GPU object behind the SAME handle.
        pool.get(hA)->retarget(static_cast<TextureHandle>(77u), /*owns=*/false);
        CHECK(pool.get(hA)->handle() == static_cast<TextureHandle>(77u),
              "a re-uploaded texture points at its new GPU object");
        CHECK(pool.get(hA) != nullptr && pool.get(hB) != nullptr,
              "and both handles still resolve — nothing above had to be told");
        CHECK(pool.get(hB)->handle() == placeholder,
              "a texture not yet re-uploaded keeps showing the placeholder");
    }

    std::printf(g_failures ? "\n%d FAILURE(S)\n" : "\nall passed\n", g_failures);
    return g_failures ? 1 : 0;
}
