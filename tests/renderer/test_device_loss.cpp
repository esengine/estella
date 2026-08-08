// Device loss: the state machine every backend shares.
//
// Under test is that a lost device cannot be half-alive: the frame stops opening
// and the report names the GPU. Per-backend guards: test_webgpu_device.cpp.

#include "MockGfxDevice.hpp"
#include "esengine/renderer/rhi/GfxEnums.hpp"

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

    std::printf(g_failures ? "\n%d FAILURE(S)\n" : "\nall passed\n", g_failures);
    return g_failures ? 1 : 0;
}
