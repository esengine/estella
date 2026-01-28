/**
 * @file    FileDialog.cpp
 * @brief   Native file dialog implementation
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */

#include "FileDialog.hpp"
#include "../core/Log.hpp"

#ifdef ES_PLATFORM_WINDOWS
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>
#include <commdlg.h>
#include <shlobj.h>
#endif

namespace esengine {

// =============================================================================
// Windows Implementation
// =============================================================================

#ifdef ES_PLATFORM_WINDOWS

std::string FileDialog::openFile(const std::string& title,
                                  const std::vector<FileFilter>& filters,
                                  const std::string& defaultPath) {
    char filename[MAX_PATH] = {0};

    std::string filterStr;
    if (filters.empty()) {
        filterStr = "All Files\0*.*\0";
    } else {
        for (const auto& filter : filters) {
            filterStr += filter.name;
            filterStr.push_back('\0');
            filterStr += filter.pattern;
            filterStr.push_back('\0');
        }
    }
    filterStr.push_back('\0');

    OPENFILENAMEA ofn = {};
    ofn.lStructSize = sizeof(ofn);
    ofn.hwndOwner = nullptr;
    ofn.lpstrFilter = filterStr.c_str();
    ofn.lpstrFile = filename;
    ofn.nMaxFile = MAX_PATH;
    ofn.lpstrTitle = title.c_str();
    ofn.Flags = OFN_FILEMUSTEXIST | OFN_PATHMUSTEXIST | OFN_NOCHANGEDIR;

    if (!defaultPath.empty()) {
        ofn.lpstrInitialDir = defaultPath.c_str();
    }

    if (GetOpenFileNameA(&ofn)) {
        return std::string(filename);
    }

    return "";
}

std::string FileDialog::saveFile(const std::string& title,
                                  const std::vector<FileFilter>& filters,
                                  const std::string& defaultPath,
                                  const std::string& defaultName) {
    char filename[MAX_PATH] = {0};

    if (!defaultName.empty()) {
        strncpy_s(filename, defaultName.c_str(), MAX_PATH - 1);
    }

    std::string filterStr;
    if (filters.empty()) {
        filterStr = "All Files\0*.*\0";
    } else {
        for (const auto& filter : filters) {
            filterStr += filter.name;
            filterStr.push_back('\0');
            filterStr += filter.pattern;
            filterStr.push_back('\0');
        }
    }
    filterStr.push_back('\0');

    OPENFILENAMEA ofn = {};
    ofn.lStructSize = sizeof(ofn);
    ofn.hwndOwner = nullptr;
    ofn.lpstrFilter = filterStr.c_str();
    ofn.lpstrFile = filename;
    ofn.nMaxFile = MAX_PATH;
    ofn.lpstrTitle = title.c_str();
    ofn.Flags = OFN_OVERWRITEPROMPT | OFN_NOCHANGEDIR;

    if (!defaultPath.empty()) {
        ofn.lpstrInitialDir = defaultPath.c_str();
    }

    if (GetSaveFileNameA(&ofn)) {
        return std::string(filename);
    }

    return "";
}

static int CALLBACK BrowseCallbackProc(HWND hwnd, UINT uMsg, LPARAM /*lParam*/, LPARAM lpData) {
    if (uMsg == BFFM_INITIALIZED && lpData != 0) {
        SendMessageA(hwnd, BFFM_SETSELECTION, TRUE, lpData);
    }
    return 0;
}

std::string FileDialog::selectFolder(const std::string& title,
                                      const std::string& defaultPath) {
    char path[MAX_PATH] = {0};

    BROWSEINFOA bi = {};
    bi.lpszTitle = title.c_str();
    bi.ulFlags = BIF_RETURNONLYFSDIRS | BIF_NEWDIALOGSTYLE;
    bi.lpfn = BrowseCallbackProc;
    bi.lParam = reinterpret_cast<LPARAM>(defaultPath.empty() ? nullptr : defaultPath.c_str());

    LPITEMIDLIST pidl = SHBrowseForFolderA(&bi);
    if (pidl != nullptr) {
        if (SHGetPathFromIDListA(pidl, path)) {
            CoTaskMemFree(pidl);
            return std::string(path);
        }
        CoTaskMemFree(pidl);
    }

    return "";
}

// =============================================================================
// macOS Implementation
// =============================================================================

#elif defined(ES_PLATFORM_MACOS)

std::string FileDialog::openFile(const std::string& /*title*/,
                                  const std::vector<FileFilter>& /*filters*/,
                                  const std::string& /*defaultPath*/) {
    ES_LOG_WARN("FileDialog::openFile not implemented on macOS");
    return "";
}

std::string FileDialog::saveFile(const std::string& /*title*/,
                                  const std::vector<FileFilter>& /*filters*/,
                                  const std::string& /*defaultPath*/,
                                  const std::string& /*defaultName*/) {
    ES_LOG_WARN("FileDialog::saveFile not implemented on macOS");
    return "";
}

std::string FileDialog::selectFolder(const std::string& /*title*/,
                                      const std::string& /*defaultPath*/) {
    ES_LOG_WARN("FileDialog::selectFolder not implemented on macOS");
    return "";
}

// =============================================================================
// Linux Implementation
// =============================================================================

#elif defined(ES_PLATFORM_LINUX)

std::string FileDialog::openFile(const std::string& /*title*/,
                                  const std::vector<FileFilter>& /*filters*/,
                                  const std::string& /*defaultPath*/) {
    ES_LOG_WARN("FileDialog::openFile not implemented on Linux");
    return "";
}

std::string FileDialog::saveFile(const std::string& /*title*/,
                                  const std::vector<FileFilter>& /*filters*/,
                                  const std::string& /*defaultPath*/,
                                  const std::string& /*defaultName*/) {
    ES_LOG_WARN("FileDialog::saveFile not implemented on Linux");
    return "";
}

std::string FileDialog::selectFolder(const std::string& /*title*/,
                                      const std::string& /*defaultPath*/) {
    ES_LOG_WARN("FileDialog::selectFolder not implemented on Linux");
    return "";
}

// =============================================================================
// Fallback (Web, etc.)
// =============================================================================

#else

std::string FileDialog::openFile(const std::string& /*title*/,
                                  const std::vector<FileFilter>& /*filters*/,
                                  const std::string& /*defaultPath*/) {
    ES_LOG_WARN("FileDialog not supported on this platform");
    return "";
}

std::string FileDialog::saveFile(const std::string& /*title*/,
                                  const std::vector<FileFilter>& /*filters*/,
                                  const std::string& /*defaultPath*/,
                                  const std::string& /*defaultName*/) {
    ES_LOG_WARN("FileDialog not supported on this platform");
    return "";
}

std::string FileDialog::selectFolder(const std::string& /*title*/,
                                      const std::string& /*defaultPath*/) {
    ES_LOG_WARN("FileDialog not supported on this platform");
    return "";
}

#endif

}  // namespace esengine
