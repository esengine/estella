/**
 * @file    WebPreviewServer.cpp
 * @brief   Local HTTP server for web preview implementation
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */

#include "WebPreviewServer.hpp"
#include "../../core/Log.hpp"

#include <sstream>
#include <filesystem>

#ifdef ES_PLATFORM_WINDOWS
#include <shellapi.h>
#include <ws2tcpip.h>
#else
#include <unistd.h>
#include <signal.h>
#include <sys/wait.h>
#include <cstdlib>
#include <sys/socket.h>
#include <netinet/in.h>
#include <arpa/inet.h>
#endif

namespace esengine {
namespace editor {

// =============================================================================
// Destructor
// =============================================================================

WebPreviewServer::~WebPreviewServer() {
    stop();
}

// =============================================================================
// Public Methods
// =============================================================================

bool WebPreviewServer::start(const std::string& directory, u16 port) {
    if (running_) {
        ES_LOG_WARN("WebPreviewServer already running on port {}", port_);
        return false;
    }

    if (!std::filesystem::exists(directory)) {
        ES_LOG_ERROR("Web build directory does not exist: {}. Please build the web version first.", directory);
        return false;
    }

    directory_ = directory;

    constexpr int MAX_PORT_ATTEMPTS = 10;
    u16 selectedPort = port;
    for (int i = 0; i < MAX_PORT_ATTEMPTS; ++i) {
        if (isPortAvailable(selectedPort)) {
            break;
        }
        ES_LOG_WARN("Port {} is in use, trying {}", selectedPort, selectedPort + 1);
        ++selectedPort;
        if (i == MAX_PORT_ATTEMPTS - 1) {
            ES_LOG_ERROR("Could not find available port after {} attempts", MAX_PORT_ATTEMPTS);
            return false;
        }
    }
    port_ = selectedPort;

#ifdef ES_PLATFORM_WINDOWS
    std::stringstream cmd;
    cmd << "python -m http.server " << port_ << " --directory \"" << directory << "\"";

    STARTUPINFOA si = {};
    si.cb = sizeof(si);
    si.dwFlags = STARTF_USESHOWWINDOW;
    si.wShowWindow = SW_HIDE;

    PROCESS_INFORMATION pi = {};

    std::string cmdStr = cmd.str();
    if (!CreateProcessA(
        nullptr,
        const_cast<char*>(cmdStr.c_str()),
        nullptr,
        nullptr,
        FALSE,
        CREATE_NO_WINDOW,
        nullptr,
        directory.c_str(),
        &si,
        &pi
    )) {
        ES_LOG_ERROR("Failed to start HTTP server: error code {}", GetLastError());
        return false;
    }

    processHandle_ = pi.hProcess;
    threadHandle_ = pi.hThread;
#else
    pid_ = fork();
    if (pid_ < 0) {
        ES_LOG_ERROR("Failed to fork process for HTTP server");
        return false;
    }

    if (pid_ == 0) {
        std::string portStr = std::to_string(port_);
        execlp("python3", "python3", "-m", "http.server", portStr.c_str(),
               "--directory", directory.c_str(), nullptr);
        execlp("python", "python", "-m", "http.server", portStr.c_str(),
               "--directory", directory.c_str(), nullptr);
        _exit(1);
    }
#endif

    running_ = true;
    ES_LOG_INFO("HTTP server started on port {} serving {}", port_, directory_);
    return true;
}

void WebPreviewServer::stop() {
    if (!running_) {
        return;
    }

#ifdef ES_PLATFORM_WINDOWS
    if (processHandle_) {
        TerminateProcess(processHandle_, 0);
        CloseHandle(processHandle_);
        processHandle_ = nullptr;
    }
    if (threadHandle_) {
        CloseHandle(threadHandle_);
        threadHandle_ = nullptr;
    }
#else
    if (pid_ > 0) {
        kill(pid_, SIGTERM);
        waitpid(pid_, nullptr, 0);
        pid_ = 0;
    }
#endif

    running_ = false;
    ES_LOG_INFO("HTTP server stopped");
}

std::string WebPreviewServer::getUrl() const {
    std::stringstream ss;
    ss << "http://localhost:" << port_ << "/";
    return ss.str();
}

void WebPreviewServer::openInBrowser(const std::string& url) {
#ifdef ES_PLATFORM_WINDOWS
    ShellExecuteA(nullptr, "open", url.c_str(), nullptr, nullptr, SW_SHOWNORMAL);
#elif defined(__APPLE__)
    std::string cmd = "open \"" + url + "\"";
    std::system(cmd.c_str());
#else
    std::string cmd = "xdg-open \"" + url + "\"";
    std::system(cmd.c_str());
#endif
}

bool WebPreviewServer::isPortAvailable(u16 port) {
#ifdef ES_PLATFORM_WINDOWS
    WSADATA wsaData;
    if (WSAStartup(MAKEWORD(2, 2), &wsaData) != 0) {
        return false;
    }

    SOCKET sock = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    if (sock == INVALID_SOCKET) {
        WSACleanup();
        return false;
    }

    sockaddr_in addr = {};
    addr.sin_family = AF_INET;
    addr.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
    addr.sin_port = htons(port);

    int result = bind(sock, reinterpret_cast<sockaddr*>(&addr), sizeof(addr));
    closesocket(sock);
    WSACleanup();

    return result == 0;
#else
    int sock = socket(AF_INET, SOCK_STREAM, 0);
    if (sock < 0) {
        return false;
    }

    sockaddr_in addr = {};
    addr.sin_family = AF_INET;
    addr.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
    addr.sin_port = htons(port);

    int result = bind(sock, reinterpret_cast<sockaddr*>(&addr), sizeof(addr));
    close(sock);

    return result == 0;
#endif
}

}  // namespace editor
}  // namespace esengine
