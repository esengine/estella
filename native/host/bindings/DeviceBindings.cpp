// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    DeviceBindings.cpp
 * @brief   es_deviceName: what a person would call this device in a list — the
 *          name a development build gives the editor when it connects. Also
 *          es_language, the device's language as its OS reports it.
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

esjs::Val js_deviceName(const esjs::Args& a) {
    return esjs::string(deviceName().c_str());
}

esjs::Val js_isHandheld(const esjs::Args& a) {
#if defined(__ANDROID__) || (defined(__APPLE__) && TARGET_OS_IPHONE)
    return esjs::boolean(true);
#else
    return esjs::boolean(false);
#endif
}

/** Asked on every call rather than kept: a player can change the system language
 *  while the game is in the background. */
esjs::Val js_language(const esjs::Args& a) {
    return esjs::string(hostAlive() && host().platform ? host().platform->language().c_str() : "");
}

esjs::Val js_deviceCapabilities(const esjs::Args& a) {
    return esjs::int32(hostAlive() && host().platform ? host().platform->deviceCapabilities() : 0);
}
esjs::Val js_startMotion(const esjs::Args& a) {
    if (!hostAlive() || !host().platform || a.size() < 3) return esjs::boolean(false);
    const int32_t interval = esjs::toInt32(a[2]);
    return esjs::boolean(host().platform->startMotion(esjs::toBool(a[0]), esjs::toBool(a[1]), interval));
}
esjs::Val js_stopMotion(const esjs::Args&) {
    if (hostAlive() && host().platform) host().platform->stopMotion();
    return esjs::undefined();
}
esjs::Val motionVector(const float* value) {
    esjs::Val object = esjs::object();
    esjs::set(object, "x", esjs::number(value[0]));
    esjs::set(object, "y", esjs::number(value[1]));
    esjs::set(object, "z", esjs::number(value[2]));
    return object;
}
esjs::Val js_pollMotion(const esjs::Args& a) {
    MotionState motion;
    if (!hostAlive() || !host().platform || !host().platform->pollMotion(motion)) return esjs::null();
    esjs::Val result = esjs::object();
    esjs::set(result, "timestamp", esjs::number(motion.timestamp));
    esjs::set(result, "accelerationIncludingGravity", motion.hasAcceleration
        ? motionVector(motion.acceleration) : esjs::null());
    esjs::set(result, "gyroscope", motion.hasGyroscope ? motionVector(motion.gyroscope) : esjs::null());
    return result;
}
esjs::Val js_vibrate(const esjs::Args& a) {
    if (!hostAlive() || !host().platform || a.size() < 2) return esjs::boolean(false);
    const int32_t duration = esjs::toInt32(a[0]), intensity = esjs::toInt32(a[1]);
    return esjs::boolean(host().platform->vibrate(duration, intensity));
}
esjs::Val js_keepScreenOn(const esjs::Args& a) {
    return esjs::boolean(hostAlive() && host().platform && a.size() > 0
        && host().platform->keepScreenOn(esjs::toBool(a[0])));
}
esjs::Val js_setTargetFrameRate(const esjs::Args& a) {
    const double fps = a.size() > 0 ? esjs::toNumber(a[0]) : 0;
    const float target = fps > 0 ? (float)fps : 0.0f;
    // The loop holds the cap (FramePacer, the same on every host); the platform only tells its OS, where it has a say.
    framePacer().setTarget(target);
    if (hostAlive() && host().platform) host().platform->setTargetFrameRate(target);
    return esjs::undefined();
}

}  // namespace

void registerDeviceBindings(HostState& h, esjs::Val global) {
    bindGlobal(global, "es_deviceName", js_deviceName, 0);
    bindGlobal(global, "es_isHandheld", js_isHandheld, 0);
    bindGlobal(global, "es_language", js_language, 0);
    bindGlobal(global, "es_deviceCapabilities", js_deviceCapabilities, 0);
    bindGlobal(global, "es_startMotion", js_startMotion, 3);
    bindGlobal(global, "es_stopMotion", js_stopMotion, 0);
    bindGlobal(global, "es_pollMotion", js_pollMotion, 0);
    bindGlobal(global, "es_vibrate", js_vibrate, 2);
    bindGlobal(global, "es_keepScreenOn", js_keepScreenOn, 1);
    bindGlobal(global, "es_setTargetFrameRate", js_setTargetFrameRate, 1);
}

}  // namespace eshost
