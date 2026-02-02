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
#include <shobjidl.h>
#include <shlobj.h>
#endif

namespace esengine {

// =============================================================================
// Windows Implementation - Modern COM API
// =============================================================================

#ifdef ES_PLATFORM_WINDOWS

namespace {

// Convert UTF-8 to wide string
std::wstring toWideString(const std::string& str) {
    if (str.empty()) return L"";
    int size = MultiByteToWideChar(CP_UTF8, 0, str.c_str(), -1, nullptr, 0);
    std::wstring result(size - 1, 0);
    MultiByteToWideChar(CP_UTF8, 0, str.c_str(), -1, &result[0], size);
    return result;
}

// Convert wide string to UTF-8
std::string toUtf8String(const std::wstring& wstr) {
    if (wstr.empty()) return "";
    int size = WideCharToMultiByte(CP_UTF8, 0, wstr.c_str(), -1, nullptr, 0, nullptr, nullptr);
    std::string result(size - 1, 0);
    WideCharToMultiByte(CP_UTF8, 0, wstr.c_str(), -1, &result[0], size, nullptr, nullptr);
    return result;
}

} // namespace

std::string FileDialog::openFile(const std::string& title,
                                  const std::vector<FileFilter>& filters,
                                  const std::string& defaultPath) {
    // Initialize COM
    HRESULT hr = CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE);
    bool comInitialized = SUCCEEDED(hr) || hr == S_FALSE;
    if (!comInitialized) {
        ES_LOG_ERROR("Failed to initialize COM for file dialog");
        return "";
    }

    std::string result;
    IFileOpenDialog* pDialog = nullptr;

    hr = CoCreateInstance(CLSID_FileOpenDialog, nullptr, CLSCTX_ALL,
                           IID_IFileOpenDialog, reinterpret_cast<void**>(&pDialog));
    if (FAILED(hr) || !pDialog) {
        ES_LOG_ERROR("Failed to create file open dialog");
        CoUninitialize();
        return "";
    }

    // Set title
    std::wstring wTitle = toWideString(title);
    pDialog->SetTitle(wTitle.c_str());

    // Set file type filters
    if (!filters.empty()) {
        std::vector<COMDLG_FILTERSPEC> specs;
        std::vector<std::wstring> names, patterns;

        for (const auto& filter : filters) {
            names.push_back(toWideString(filter.name));
            std::string pattern = filter.pattern;
            if (!pattern.empty() && pattern[0] != '*') {
                pattern = "*." + pattern;
            }
            patterns.push_back(toWideString(pattern));
        }

        for (size_t i = 0; i < filters.size(); ++i) {
            specs.push_back({names[i].c_str(), patterns[i].c_str()});
        }

        pDialog->SetFileTypes(static_cast<UINT>(specs.size()), specs.data());
        pDialog->SetFileTypeIndex(1);
    }

    // Set default folder
    if (!defaultPath.empty()) {
        IShellItem* pFolder = nullptr;
        std::wstring wPath = toWideString(defaultPath);
        hr = SHCreateItemFromParsingName(wPath.c_str(), nullptr, IID_IShellItem,
                                          reinterpret_cast<void**>(&pFolder));
        if (SUCCEEDED(hr) && pFolder) {
            pDialog->SetFolder(pFolder);
            pFolder->Release();
        }
    }

    // Show dialog
    hr = pDialog->Show(nullptr);
    if (SUCCEEDED(hr)) {
        IShellItem* pItem = nullptr;
        hr = pDialog->GetResult(&pItem);
        if (SUCCEEDED(hr) && pItem) {
            PWSTR pszPath = nullptr;
            hr = pItem->GetDisplayName(SIGDN_FILESYSPATH, &pszPath);
            if (SUCCEEDED(hr) && pszPath) {
                result = toUtf8String(pszPath);
                CoTaskMemFree(pszPath);
            }
            pItem->Release();
        }
    }

    pDialog->Release();
    CoUninitialize();

    return result;
}

std::string FileDialog::saveFile(const std::string& title,
                                  const std::vector<FileFilter>& filters,
                                  const std::string& defaultPath,
                                  const std::string& defaultName) {
    // Initialize COM
    HRESULT hr = CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE);
    bool comInitialized = SUCCEEDED(hr) || hr == S_FALSE;
    if (!comInitialized) {
        ES_LOG_ERROR("Failed to initialize COM for file dialog");
        return "";
    }

    std::string result;
    IFileSaveDialog* pDialog = nullptr;

    hr = CoCreateInstance(CLSID_FileSaveDialog, nullptr, CLSCTX_ALL,
                           IID_IFileSaveDialog, reinterpret_cast<void**>(&pDialog));
    if (FAILED(hr) || !pDialog) {
        ES_LOG_ERROR("Failed to create file save dialog");
        CoUninitialize();
        return "";
    }

    // Set title
    std::wstring wTitle = toWideString(title);
    pDialog->SetTitle(wTitle.c_str());

    // Set file type filters
    std::string defaultExtension;
    if (!filters.empty()) {
        std::vector<COMDLG_FILTERSPEC> specs;
        std::vector<std::wstring> names, patterns;

        for (const auto& filter : filters) {
            names.push_back(toWideString(filter.name));
            std::string pattern = filter.pattern;
            if (!pattern.empty() && pattern[0] != '*') {
                defaultExtension = pattern;
                pattern = "*." + pattern;
            }
            patterns.push_back(toWideString(pattern));
        }

        for (size_t i = 0; i < filters.size(); ++i) {
            specs.push_back({names[i].c_str(), patterns[i].c_str()});
        }

        pDialog->SetFileTypes(static_cast<UINT>(specs.size()), specs.data());
        pDialog->SetFileTypeIndex(1);

        if (!defaultExtension.empty()) {
            std::wstring wExt = toWideString(defaultExtension);
            pDialog->SetDefaultExtension(wExt.c_str());
        }
    }

    // Set default filename
    if (!defaultName.empty()) {
        std::wstring wName = toWideString(defaultName);
        pDialog->SetFileName(wName.c_str());
    }

    // Set default folder
    if (!defaultPath.empty()) {
        IShellItem* pFolder = nullptr;
        std::wstring wPath = toWideString(defaultPath);
        hr = SHCreateItemFromParsingName(wPath.c_str(), nullptr, IID_IShellItem,
                                          reinterpret_cast<void**>(&pFolder));
        if (SUCCEEDED(hr) && pFolder) {
            pDialog->SetFolder(pFolder);
            pFolder->Release();
        }
    }

    // Show dialog
    hr = pDialog->Show(nullptr);
    if (SUCCEEDED(hr)) {
        IShellItem* pItem = nullptr;
        hr = pDialog->GetResult(&pItem);
        if (SUCCEEDED(hr) && pItem) {
            PWSTR pszPath = nullptr;
            hr = pItem->GetDisplayName(SIGDN_FILESYSPATH, &pszPath);
            if (SUCCEEDED(hr) && pszPath) {
                result = toUtf8String(pszPath);
                CoTaskMemFree(pszPath);
            }
            pItem->Release();
        }
    }

    pDialog->Release();
    CoUninitialize();

    return result;
}

std::string FileDialog::selectFolder(const std::string& title,
                                      const std::string& defaultPath) {
    // Initialize COM
    HRESULT hr = CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE);
    bool comInitialized = SUCCEEDED(hr) || hr == S_FALSE;
    if (!comInitialized) {
        ES_LOG_ERROR("Failed to initialize COM for folder dialog");
        return "";
    }

    std::string result;
    IFileOpenDialog* pDialog = nullptr;

    hr = CoCreateInstance(CLSID_FileOpenDialog, nullptr, CLSCTX_ALL,
                           IID_IFileOpenDialog, reinterpret_cast<void**>(&pDialog));
    if (FAILED(hr) || !pDialog) {
        ES_LOG_ERROR("Failed to create folder dialog");
        CoUninitialize();
        return "";
    }

    // Set options to pick folders
    DWORD options;
    pDialog->GetOptions(&options);
    pDialog->SetOptions(options | FOS_PICKFOLDERS);

    // Set title
    std::wstring wTitle = toWideString(title);
    pDialog->SetTitle(wTitle.c_str());

    // Set default folder
    if (!defaultPath.empty()) {
        IShellItem* pFolder = nullptr;
        std::wstring wPath = toWideString(defaultPath);
        hr = SHCreateItemFromParsingName(wPath.c_str(), nullptr, IID_IShellItem,
                                          reinterpret_cast<void**>(&pFolder));
        if (SUCCEEDED(hr) && pFolder) {
            pDialog->SetFolder(pFolder);
            pFolder->Release();
        }
    }

    // Show dialog
    hr = pDialog->Show(nullptr);
    if (SUCCEEDED(hr)) {
        IShellItem* pItem = nullptr;
        hr = pDialog->GetResult(&pItem);
        if (SUCCEEDED(hr) && pItem) {
            PWSTR pszPath = nullptr;
            hr = pItem->GetDisplayName(SIGDN_FILESYSPATH, &pszPath);
            if (SUCCEEDED(hr) && pszPath) {
                result = toUtf8String(pszPath);
                CoTaskMemFree(pszPath);
            }
            pItem->Release();
        }
    }

    pDialog->Release();
    CoUninitialize();

    return result;
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
