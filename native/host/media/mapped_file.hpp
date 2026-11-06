// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    mapped_file.hpp
 * @brief   A read-only file mapped into memory, for the glyph rasterizer's fonts.
 *
 * @details A system CJK font is tens of MB and a game draws a few hundred of its
 *          glyphs. Mapped, the OS pages in only what the parser touches and
 *          shares those pages with every other process using the same font;
 *          read, every byte is copied off storage before the first glyph. Where a
 *          mapping is refused the file is read whole instead, so the caller sees
 *          the same bytes either way. Move-only: the mapping lives as long as the
 *          object does.
 */
#pragma once

#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <string>
#include <utility>
#include <vector>

#if defined(_WIN32)
#  ifndef WIN32_LEAN_AND_MEAN
#    define WIN32_LEAN_AND_MEAN
#  endif
#  ifndef NOMINMAX
#    define NOMINMAX
#  endif
#  include <windows.h>
#else
#  include <fcntl.h>
#  include <sys/mman.h>
#  include <sys/stat.h>
#  include <unistd.h>
#endif

namespace eshost {

class MappedFile {
public:
    MappedFile() = default;
    MappedFile(const MappedFile&) = delete;
    MappedFile& operator=(const MappedFile&) = delete;
    MappedFile(MappedFile&& other) noexcept { *this = std::move(other); }
    MappedFile& operator=(MappedFile&& other) noexcept {
        if (this != &other) {
            release();
            data_ = std::exchange(other.data_, nullptr);
            size_ = std::exchange(other.size_, 0);
            mapped_ = std::exchange(other.mapped_, false);
            copy_ = std::move(other.copy_);
        }
        return *this;
    }
    ~MappedFile() { release(); }

    /** Maps @p path (UTF-8). False, and empty, when it cannot be opened or is empty. */
    bool open(const std::string& path) {
        release();
        if (path.empty()) return false;
        if (map(path)) return true;
        return readWhole(path);
    }

    const uint8_t* data() const { return data_; }
    size_t size() const { return size_; }
    bool empty() const { return size_ == 0; }
    /** Mapped rather than copied: for a log line, and for the test that keeps it so. */
    bool mapped() const { return mapped_; }

private:
    const uint8_t* data_ = nullptr;
    size_t size_ = 0;
    bool mapped_ = false;
    std::vector<uint8_t> copy_;

#if defined(_WIN32)
    static std::wstring widen(const std::string& s) {
        const int n = MultiByteToWideChar(CP_UTF8, 0, s.data(), (int)s.size(), nullptr, 0);
        std::wstring w((size_t)(n > 0 ? n : 0), L'\0');
        if (n > 0) MultiByteToWideChar(CP_UTF8, 0, s.data(), (int)s.size(), w.data(), n);
        return w;
    }
    bool map(const std::string& path) {
        HANDLE file = CreateFileW(widen(path).c_str(), GENERIC_READ, FILE_SHARE_READ, nullptr, OPEN_EXISTING,
                                  FILE_ATTRIBUTE_NORMAL, nullptr);
        if (file == INVALID_HANDLE_VALUE) return false;
        LARGE_INTEGER size{};
        HANDLE mapping = nullptr;
        if (GetFileSizeEx(file, &size) && size.QuadPart > 0) {
            mapping = CreateFileMappingW(file, nullptr, PAGE_READONLY, 0, 0, nullptr);
        }
        CloseHandle(file);   // the mapping holds the file open
        if (!mapping) return false;
        void* view = MapViewOfFile(mapping, FILE_MAP_READ, 0, 0, 0);
        CloseHandle(mapping);   // and the view holds the mapping
        if (!view) return false;
        data_ = static_cast<const uint8_t*>(view);
        size_ = (size_t)size.QuadPart;
        mapped_ = true;
        return true;
    }
    void unmap() { UnmapViewOfFile(data_); }
#else
    bool map(const std::string& path) {
        const int fd = ::open(path.c_str(), O_RDONLY | O_CLOEXEC);
        if (fd < 0) return false;
        struct stat st{};
        void* view = MAP_FAILED;
        if (fstat(fd, &st) == 0 && st.st_size > 0) {
            view = mmap(nullptr, (size_t)st.st_size, PROT_READ, MAP_PRIVATE, fd, 0);
        }
        ::close(fd);   // the mapping holds the file
        if (view == MAP_FAILED) return false;
        data_ = static_cast<const uint8_t*>(view);
        size_ = (size_t)st.st_size;
        mapped_ = true;
        return true;
    }
    void unmap() { munmap(const_cast<uint8_t*>(data_), size_); }
#endif

    bool readWhole(const std::string& path) {
#if defined(_WIN32)
        FILE* f = _wfopen(widen(path).c_str(), L"rb");
#else
        FILE* f = std::fopen(path.c_str(), "rb");
#endif
        if (!f) return false;
        std::fseek(f, 0, SEEK_END);
        const long size = std::ftell(f);
        std::fseek(f, 0, SEEK_SET);
        if (size > 0) {
            copy_.resize((size_t)size);
            if (std::fread(copy_.data(), 1, copy_.size(), f) != copy_.size()) copy_.clear();
        }
        std::fclose(f);
        data_ = copy_.empty() ? nullptr : copy_.data();
        size_ = copy_.size();
        return size_ > 0;
    }

    void release() {
        if (mapped_ && data_) unmap();
        data_ = nullptr;
        size_ = 0;
        mapped_ = false;
        copy_.clear();
    }
};

}  // namespace eshost
