// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    DeviceBindings.cpp
 * @brief   es_deviceName: what a person would call this device in a list — the
 *          name a development build gives the editor when it connects.
 */
#include "Bindings.hpp"

#include <string>

#if defined(__ANDROID__)
#  include <sys/system_properties.h>
#elif defined(__APPLE__)
#  include <TargetConditionals.h>
#  include <sys/sysctl.h>
#  include <sys/utsname.h>
#elif defined(_WIN32)
#  ifndef WIN32_LEAN_AND_MEAN
#    define WIN32_LEAN_AND_MEAN
#  endif
#  include <windows.h>
#else
#  include <fstream>
#endif

namespace eshost {
namespace {

std::string deviceName() {
#if defined(__ANDROID__)
    char model[PROP_VALUE_MAX] = {0};
    __system_property_get("ro.product.model", model);
    return std::string("Android · ") + model;
#elif defined(__APPLE__) && TARGET_OS_IPHONE
    utsname u{};
    uname(&u);
    return std::string("iOS · ") + u.machine;
#elif defined(__APPLE__)
    char model[128] = {0};
    size_t len = sizeof model;
    sysctlbyname("hw.model", model, &len, nullptr, 0);
    return std::string("macOS · ") + model;
#elif defined(_WIN32)
    char name[MAX_COMPUTERNAME_LENGTH + 1] = {0};
    DWORD len = sizeof name;
    GetComputerNameA(name, &len);
    return std::string("Windows · ") + name;
#else
    std::string product;
    std::ifstream("/sys/devices/virtual/dmi/id/product_name") >> product;
    return "Linux" + (product.empty() ? std::string() : " · " + product);
#endif
}

JSValue js_deviceName(JSContext* ctx, JSValueConst, int, JSValueConst*) {
    return JS_NewString(ctx, deviceName().c_str());
}

JSValue js_deviceCapabilities(JSContext* ctx, JSValueConst, int, JSValueConst*) {
    return JS_NewInt32(ctx, hostAlive() && host().platform ? host().platform->deviceCapabilities() : 0);
}
JSValue js_startMotion(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv) {
    if (!hostAlive() || !host().platform || argc < 3) return JS_FALSE;
    int32_t interval = 16;
    if (JS_ToInt32(ctx, &interval, argv[2]) < 0) return JS_EXCEPTION;
    return JS_NewBool(ctx, host().platform->startMotion(JS_ToBool(ctx, argv[0]) > 0,
        JS_ToBool(ctx, argv[1]) > 0, interval));
}
JSValue js_stopMotion(JSContext*, JSValueConst, int, JSValueConst*) {
    if (hostAlive() && host().platform) host().platform->stopMotion();
    return JS_UNDEFINED;
}
JSValue motionVector(JSContext* ctx, const float* value) {
    JSValue object = JS_NewObject(ctx);
    JS_SetPropertyStr(ctx, object, "x", JS_NewFloat64(ctx, value[0]));
    JS_SetPropertyStr(ctx, object, "y", JS_NewFloat64(ctx, value[1]));
    JS_SetPropertyStr(ctx, object, "z", JS_NewFloat64(ctx, value[2]));
    return object;
}
JSValue js_pollMotion(JSContext* ctx, JSValueConst, int, JSValueConst*) {
    MotionState motion;
    if (!hostAlive() || !host().platform || !host().platform->pollMotion(motion)) return JS_NULL;
    JSValue result = JS_NewObject(ctx);
    JS_SetPropertyStr(ctx, result, "timestamp", JS_NewFloat64(ctx, motion.timestamp));
    JS_SetPropertyStr(ctx, result, "accelerationIncludingGravity", motion.hasAcceleration
        ? motionVector(ctx, motion.acceleration) : JS_NULL);
    JS_SetPropertyStr(ctx, result, "gyroscope", motion.hasGyroscope ? motionVector(ctx, motion.gyroscope) : JS_NULL);
    return result;
}
JSValue js_vibrate(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv) {
    if (!hostAlive() || !host().platform || argc < 2) return JS_FALSE;
    int32_t duration = 15, intensity = 2;
    if (JS_ToInt32(ctx, &duration, argv[0]) < 0 || JS_ToInt32(ctx, &intensity, argv[1]) < 0) return JS_EXCEPTION;
    return JS_NewBool(ctx, host().platform->vibrate(duration, intensity));
}
JSValue js_keepScreenOn(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv) {
    return JS_NewBool(ctx, hostAlive() && host().platform && argc > 0
        && host().platform->keepScreenOn(JS_ToBool(ctx, argv[0]) > 0));
}
JSValue js_setTargetFrameRate(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv) {
    double fps = 0;
    if (argc > 0 && JS_ToFloat64(ctx, &fps, argv[0]) < 0) return JS_EXCEPTION;
    if (hostAlive() && host().platform) host().platform->setTargetFrameRate(fps > 0 ? (float)fps : 0.0f);
    return JS_UNDEFINED;
}

}  // namespace

void registerDeviceBindings(HostState& h, JSValue global) {
    bindGlobal(h, global, "es_deviceName", js_deviceName, 0);
    bindGlobal(h, global, "es_deviceCapabilities", js_deviceCapabilities, 0);
    bindGlobal(h, global, "es_startMotion", js_startMotion, 3);
    bindGlobal(h, global, "es_stopMotion", js_stopMotion, 0);
    bindGlobal(h, global, "es_pollMotion", js_pollMotion, 0);
    bindGlobal(h, global, "es_vibrate", js_vibrate, 2);
    bindGlobal(h, global, "es_keepScreenOn", js_keepScreenOn, 1);
    bindGlobal(h, global, "es_setTargetFrameRate", js_setTargetFrameRate, 1);
}

}  // namespace eshost
