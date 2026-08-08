// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    windows_common.cpp
 * @brief   DirectWrite font matching and WinHTTP fetching. See the header.
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the Apache License, Version 2.0.
 */
#include "platform/windows_common.hpp"

#include <windows.h>
#include <dwrite.h>
#include <winhttp.h>

#include <thread>
#include <vector>

#include "media/glyph_raster.hpp"   // GLYPH_BOLD / GLYPH_ITALIC

namespace eshost {
namespace {

using esengine::u8;
using esengine::u32;

std::wstring widen(const std::string& text) {
    if (text.empty()) return {};
    const int n = MultiByteToWideChar(CP_UTF8, 0, text.c_str(), (int)text.size(), nullptr, 0);
    std::wstring out((size_t)n, L'\0');
    MultiByteToWideChar(CP_UTF8, 0, text.c_str(), (int)text.size(), out.data(), n);
    return out;
}

std::string narrow(const std::wstring& text) {
    if (text.empty()) return {};
    const int n = WideCharToMultiByte(CP_UTF8, 0, text.c_str(), (int)text.size(),
                                      nullptr, 0, nullptr, nullptr);
    std::string out((size_t)n, '\0');
    WideCharToMultiByte(CP_UTF8, 0, text.c_str(), (int)text.size(), out.data(), n, nullptr, nullptr);
    return out;
}

/** The process-wide DirectWrite factory. Created once: the factory is the
 *  expensive part and the system font collection hangs off it. */
IDWriteFactory* factory() {
    static IDWriteFactory* f = [] {
        IDWriteFactory* created = nullptr;
        DWriteCreateFactory(DWRITE_FACTORY_TYPE_SHARED, __uuidof(IDWriteFactory),
                            reinterpret_cast<IUnknown**>(&created));
        return created;
    }();
    return f;
}

/** The file behind a font face, and which face inside it. A collection (.ttc)
 *  holds several, so the index has to travel with the bytes. */
bool readFaceFile(IDWriteFontFace* face, FontFile& out) {
    UINT32 fileCount = 0;
    if (FAILED(face->GetFiles(&fileCount, nullptr)) || fileCount == 0) return false;
    std::vector<IDWriteFontFile*> files(fileCount, nullptr);
    if (FAILED(face->GetFiles(&fileCount, files.data()))) return false;

    bool ok = false;
    const void* key = nullptr;
    UINT32 keySize = 0;
    IDWriteFontFileLoader* loader = nullptr;
    if (SUCCEEDED(files[0]->GetReferenceKey(&key, &keySize))
        && SUCCEEDED(files[0]->GetLoader(&loader)) && loader) {
        IDWriteLocalFontFileLoader* local = nullptr;
        if (SUCCEEDED(loader->QueryInterface(__uuidof(IDWriteLocalFontFileLoader),
                                             reinterpret_cast<void**>(&local))) && local) {
            UINT32 length = 0;
            if (SUCCEEDED(local->GetFilePathLengthFromKey(key, keySize, &length))) {
                std::wstring path(length + 1, L'\0');
                if (SUCCEEDED(local->GetFilePathFromKey(key, keySize, path.data(), length + 1))) {
                    path.resize(length);
                    if (HANDLE handle = CreateFileW(path.c_str(), GENERIC_READ, FILE_SHARE_READ,
                                                    nullptr, OPEN_EXISTING,
                                                    FILE_ATTRIBUTE_NORMAL, nullptr);
                        handle != INVALID_HANDLE_VALUE) {
                        LARGE_INTEGER size{};
                        if (GetFileSizeEx(handle, &size) && size.QuadPart > 0) {
                            out.bytes.resize((size_t)size.QuadPart);
                            DWORD read = 0;
                            ok = ReadFile(handle, out.bytes.data(), (DWORD)out.bytes.size(), &read, nullptr)
                                && read == out.bytes.size();
                        }
                        CloseHandle(handle);
                    }
                    if (ok) {
                        out.path = narrow(path);
                        out.faceIndex = (int)face->GetIndex();
                    }
                }
            }
            local->Release();
        }
        loader->Release();
    }
    for (IDWriteFontFile* file : files) if (file) file->Release();
    return ok;
}

}  // namespace

FontFile windowsLoadFont(const std::string& family, u32 codepoint, int style) {
    FontFile out;
    IDWriteFactory* dw = factory();
    if (!dw) return out;

    IDWriteFontCollection* collection = nullptr;
    if (FAILED(dw->GetSystemFontCollection(&collection, FALSE)) || !collection) return out;

    const DWRITE_FONT_WEIGHT weight = (style & GLYPH_BOLD)
        ? DWRITE_FONT_WEIGHT_BOLD : DWRITE_FONT_WEIGHT_NORMAL;
    const DWRITE_FONT_STYLE slant = (style & GLYPH_ITALIC)
        ? DWRITE_FONT_STYLE_ITALIC : DWRITE_FONT_STYLE_NORMAL;

    // Segoe UI is the system font, and the fallback when the family is unknown —
    // the same role Helvetica plays on Apple.
    const std::wstring wanted = widen(family.empty() ? "Segoe UI" : family);
    UINT32 index = 0;
    BOOL exists = FALSE;
    if (FAILED(collection->FindFamilyName(wanted.c_str(), &index, &exists)) || !exists) {
        collection->FindFamilyName(L"Segoe UI", &index, &exists);
    }
    if (!exists) { collection->Release(); return out; }

    IDWriteFontFamily* fam = nullptr;
    if (FAILED(collection->GetFontFamily(index, &fam)) || !fam) { collection->Release(); return out; }

    IDWriteFont* font = nullptr;
    if (FAILED(fam->GetFirstMatchingFont(weight, DWRITE_FONT_STRETCH_NORMAL, slant, &font)) || !font) {
        fam->Release();
        collection->Release();
        return out;
    }

    // A family with no real bold or italic face leaves the trait unmet; the
    // rasterizer then synthesizes it, as a browser does for the same family.
    out.syntheticBold = (style & GLYPH_BOLD) && font->GetWeight() < DWRITE_FONT_WEIGHT_SEMI_BOLD;
    out.syntheticItalic = (style & GLYPH_ITALIC) && font->GetStyle() == DWRITE_FONT_STYLE_NORMAL;

    // Does this face cover the codepoint? If not, let DirectWrite find one that
    // does — the CJK fallback, which is the whole reason this is platform code.
    if (codepoint) {
        BOOL has = FALSE;
        if (SUCCEEDED(font->HasCharacter(codepoint, &has)) && !has) {
            for (UINT32 i = 0; i < collection->GetFontFamilyCount(); ++i) {
                IDWriteFontFamily* candidate = nullptr;
                if (FAILED(collection->GetFontFamily(i, &candidate)) || !candidate) continue;
                IDWriteFont* other = nullptr;
                if (SUCCEEDED(candidate->GetFirstMatchingFont(weight, DWRITE_FONT_STRETCH_NORMAL,
                                                              slant, &other)) && other) {
                    BOOL covers = FALSE;
                    if (SUCCEEDED(other->HasCharacter(codepoint, &covers)) && covers) {
                        font->Release();
                        font = other;
                        candidate->Release();
                        break;
                    }
                    other->Release();
                }
                candidate->Release();
            }
        }
    }

    IDWriteFontFace* face = nullptr;
    if (SUCCEEDED(font->CreateFontFace(&face)) && face) {
        if (!readFaceFile(face, out)) out.path.clear();
        face->Release();
    }
    font->Release();
    fam->Release();
    collection->Release();
    return out;
}

void windowsStartFetch(const FetchRequest& req) {
    // A detached thread per request, as NSURLSession's completion queue is on
    // Apple: WinHTTP's synchronous API is the simple one, and the reply reaches
    // JS through deliverFetch, which is thread-safe by contract.
    std::thread([req]() {
        FetchResult result;
        result.id = req.id;
        result.isText = req.wantText;

        const std::wstring url = widen(req.url);
        URL_COMPONENTS parts{};
        parts.dwStructSize = sizeof(parts);
        wchar_t host[256]{};
        wchar_t path[4096]{};
        parts.lpszHostName = host;
        parts.dwHostNameLength = (DWORD)std::size(host);
        parts.lpszUrlPath = path;
        parts.dwUrlPathLength = (DWORD)std::size(path);
        if (!WinHttpCrackUrl(url.c_str(), (DWORD)url.size(), 0, &parts)) {
            result.error = "invalid url";
            deliverFetch(std::move(result));
            return;
        }

        HINTERNET session = WinHttpOpen(L"Estella", WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY,
                                        WINHTTP_NO_PROXY_NAME, WINHTTP_NO_PROXY_BYPASS, 0);
        HINTERNET connection = session
            ? WinHttpConnect(session, host, parts.nPort, 0) : nullptr;
        const DWORD flags = parts.nScheme == INTERNET_SCHEME_HTTPS ? WINHTTP_FLAG_SECURE : 0;
        HINTERNET request = connection
            ? WinHttpOpenRequest(connection, widen(req.method.empty() ? "GET" : req.method).c_str(),
                                 path, nullptr, WINHTTP_NO_REFERER,
                                 WINHTTP_DEFAULT_ACCEPT_TYPES, flags)
            : nullptr;
        if (!request) {
            result.error = "connection failed";
            if (connection) WinHttpCloseHandle(connection);
            if (session) WinHttpCloseHandle(session);
            deliverFetch(std::move(result));
            return;
        }

        for (const auto& [name, value] : req.headers) {
            const std::wstring header = widen(name + ": " + value);
            WinHttpAddRequestHeaders(request, header.c_str(), (DWORD)header.size(),
                                     WINHTTP_ADDREQ_FLAG_ADD);
        }

        const bool sent = WinHttpSendRequest(
            request, WINHTTP_NO_ADDITIONAL_HEADERS, 0,
            req.body.empty() ? WINHTTP_NO_REQUEST_DATA : (LPVOID)req.body.data(),
            (DWORD)req.body.size(), (DWORD)req.body.size(), 0) != FALSE;
        if (!sent || !WinHttpReceiveResponse(request, nullptr)) {
            result.error = "request failed";
        } else {
            DWORD status = 0, size = sizeof(status);
            WinHttpQueryHeaders(request, WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER,
                                WINHTTP_HEADER_NAME_BY_INDEX, &status, &size, WINHTTP_NO_HEADER_INDEX);
            result.status = (int)status;
            result.ok = status >= 200 && status < 300;

            DWORD available = 0;
            while (WinHttpQueryDataAvailable(request, &available) && available > 0) {
                const size_t at = result.body.size();
                result.body.resize(at + available);
                DWORD read = 0;
                if (!WinHttpReadData(request, result.body.data() + at, available, &read)) break;
                result.body.resize(at + read);
            }
        }

        WinHttpCloseHandle(request);
        WinHttpCloseHandle(connection);
        WinHttpCloseHandle(session);
        deliverFetch(std::move(result));
    }).detach();
}

}  // namespace eshost
