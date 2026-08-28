// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    DynamicLibrary.hpp
 * @brief   Open a shared library and take a symbol out of it.
 *
 * @details Three lines of platform per operation, and every place that needs
 *          them writes the same three. Two do now — the Steamworks flat API,
 *          which carries no Valve header on purpose, and the compiled systems a
 *          native host loads — and a third copy is how they start to differ
 *          about `RTLD_LOCAL` or about what a null handle means.
 *
 *          Header-only and free of the engine, so a host, a harness or a tool
 *          can use it without linking anything.
 *
 *          It does NOT throw and does NOT log: what a failed open means is the
 *          caller's, since a missing Steam library is a feature nobody bought
 *          and a missing systems module is a build that cannot run.
 */
#pragma once

#if defined(_WIN32)
#  ifndef WIN32_LEAN_AND_MEAN
#    define WIN32_LEAN_AND_MEAN
#  endif
// min/max arrive as MACROS otherwise, and the next numeric_limits<T>::max()
// in any translation unit that included this reads as ::() -- reported
// against that line, never against this one.
#  ifndef NOMINMAX
#    define NOMINMAX
#  endif
#  include <windows.h>
#else
#  include <dlfcn.h>
#endif

namespace esengine::core {

/** A loaded library, or nullptr. The path is taken as given — a leaf name is
 *  searched the way the platform searches one, which is rarely what a caller
 *  wants; pass an absolute path unless the search IS the intent. */
inline void* openLibrary(const char* path) {
#if defined(_WIN32)
    return reinterpret_cast<void*>(::LoadLibraryA(path));
#else
    // LOCAL, so a symbol here cannot satisfy an unrelated lookup elsewhere.
    return ::dlopen(path, RTLD_LAZY | RTLD_LOCAL);
#endif
}

/** Safe on nullptr, because "close whatever I got" is every caller's shape. */
inline void closeLibrary(void* handle) {
    if (handle == nullptr) return;
#if defined(_WIN32)
    ::FreeLibrary(reinterpret_cast<HMODULE>(handle));
#else
    ::dlclose(handle);
#endif
}

/** The address of an exported symbol, or nullptr — including for a null handle,
 *  so a caller that failed to open needs no second branch. */
inline void* librarySymbol(void* handle, const char* name) {
    if (handle == nullptr) return nullptr;
#if defined(_WIN32)
    return reinterpret_cast<void*>(::GetProcAddress(reinterpret_cast<HMODULE>(handle), name));
#else
    return ::dlsym(handle, name);
#endif
}

}  // namespace esengine::core
