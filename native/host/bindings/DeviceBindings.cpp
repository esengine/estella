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

}  // namespace

void registerDeviceBindings(HostState& h, JSValue global) {
    bindGlobal(h, global, "es_deviceName", js_deviceName, 0);
}

}  // namespace eshost
