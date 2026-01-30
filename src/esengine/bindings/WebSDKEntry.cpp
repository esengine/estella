/**
 * @file    WebSDKEntry.cpp
 * @brief   ESEngine Web SDK entry point
 * @details Minimal entry for SDK library, no application logic
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */

#ifdef ES_PLATFORM_WEB

#include <emscripten.h>

extern "C" {

EMSCRIPTEN_KEEPALIVE
void es_sdk_init() {
    // SDK initialization - can be extended as needed
}

EMSCRIPTEN_KEEPALIVE
const char* es_sdk_version() {
    return "0.1.0";
}

}  // extern "C"

int main() {
    // Empty main - SDK is library-only, no application loop
    return 0;
}

#endif  // ES_PLATFORM_WEB
