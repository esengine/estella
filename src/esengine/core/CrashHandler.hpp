/**
 * @file    CrashHandler.hpp
 * @brief   Crash handling and reporting utilities
 * @details Captures unhandled exceptions and displays error information
 *          before the application terminates.
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */
#pragma once

#include <string>

namespace esengine {

// =============================================================================
// CrashHandler
// =============================================================================

class CrashHandler {
public:
    static void init();
    static void shutdown();

    static void setAppName(const std::string& name);
    static const std::string& getAppName() { return app_name_; }

private:
    static std::string app_name_;

    friend long __stdcall unhandledExceptionFilterImpl(void*);
    friend void signalHandlerImpl(int);
};

}  // namespace esengine
