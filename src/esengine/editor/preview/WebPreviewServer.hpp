/**
 * @file    WebPreviewServer.hpp
 * @brief   Local HTTP server for web preview
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */
#pragma once

#include "../../core/Types.hpp"
#include <string>

#ifdef ES_PLATFORM_WINDOWS
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#endif

namespace esengine {
namespace editor {

class WebPreviewServer {
public:
    WebPreviewServer() = default;
    ~WebPreviewServer();

    WebPreviewServer(const WebPreviewServer&) = delete;
    WebPreviewServer& operator=(const WebPreviewServer&) = delete;

    bool start(const std::string& directory, u16 port = 8080);
    void stop();
    bool isRunning() const { return running_; }
    u16 getPort() const { return port_; }
    std::string getUrl() const;

    static void openInBrowser(const std::string& url);

private:
    bool running_ = false;
    u16 port_ = 8080;
    std::string directory_;

#ifdef ES_PLATFORM_WINDOWS
    HANDLE processHandle_ = nullptr;
    HANDLE threadHandle_ = nullptr;
#else
    pid_t pid_ = 0;
#endif
};

}  // namespace editor
}  // namespace esengine
