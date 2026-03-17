/**
 * @file    FileSystem.hpp
 * @brief   Cross-platform file system abstraction with hot reload support
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */

#pragma once

#include "../core/Types.hpp"
#include <string>
#include <vector>
#include <functional>

namespace esengine {

/**
 * @brief Platform-independent file system interface
 *
 * @details Provides file I/O operations and file monitoring for hot reload.
 *          - Native platforms use standard C++ filesystem and OS-specific file watchers
 *          - Web platforms use Emscripten virtual filesystem with preloaded assets
 */
class FileSystem {
public:
    /**
     * @brief Initialize the file system
     * @note Must be called before any file operations
     */
    static void init();

    /**
     * @brief Shutdown the file system and clean up watchers
     */
    static void shutdown();

    /**
     * @brief Update file watchers (call once per frame)
     * @note Required for polling-based file monitoring
     */
    static void update();

    // =========================================================================
    // File Operations
    // =========================================================================

    /**
     * @brief Check if a file exists
     * @param path File path (relative or absolute)
     * @return true if file exists and is readable
     */
    static bool fileExists(const std::string& path);

    /**
     * @brief Read entire file as text
     * @param path File path
     * @return File contents as string, empty string on error
     */
    static std::string readTextFile(const std::string& path);

    /**
     * @brief Read entire file as binary data
     * @param path File path
     * @return File contents as byte vector, empty on error
     */
    static std::vector<u8> readBinaryFile(const std::string& path);

    /**
     * @brief Write text to file
     * @param path File path
     * @param content Text content to write
     * @return true if write succeeded
     */
    static bool writeTextFile(const std::string& path, const std::string& content);

    /**
     * @brief Write binary data to file
     * @param path File path
     * @param data Binary data to write
     * @return true if write succeeded
     */
    static bool writeBinaryFile(const std::string& path, const std::vector<u8>& data);

    /**
     * @brief Get file size in bytes
     * @param path File path
     * @return File size, 0 on error
     */
    static usize getFileSize(const std::string& path);

    /**
     * @brief Get last modification time (Unix timestamp)
     * @param path File path
     * @return Modification time in seconds since epoch, 0 on error
     */
    static u64 getFileModificationTime(const std::string& path);

    // =========================================================================
    // Directory Operations
    // =========================================================================

    /**
     * @brief Check if a directory exists
     * @param path Directory path
     * @return true if directory exists
     */
    static bool directoryExists(const std::string& path);

    /**
     * @brief List all files in a directory
     * @param path Directory path
     * @param recursive If true, list files in subdirectories
     * @return Vector of file paths (relative to input path)
     */
    static std::vector<std::string> listDirectory(const std::string& path, bool recursive = false);

    /**
     * @brief Create a directory (and parent directories if needed)
     * @param path Directory path
     * @return true if creation succeeded or directory already exists
     */
    static bool createDirectory(const std::string& path);

    // =========================================================================
    // File Monitoring (Hot Reload)
    // =========================================================================

    /**
     * @brief Watch a file for changes
     * @param path File path to watch
     * @param callback Function called when file changes (receives file path)
     *
     * @details Implementation varies by platform:
     *          - Windows: Uses ReadDirectoryChangesW (native event-based)
     *          - Linux: Uses inotify (native event-based)
     *          - macOS: Uses FSEvents (native event-based)
     *          - Fallback: Polling via update() (checks mtime every frame)
     *
     * @note Callback is called on the main thread during update()
     */
    static void watchFile(const std::string& path,
                         std::function<void(const std::string&)> callback);

    /**
     * @brief Stop watching a file
     * @param path File path to unwatch
     */
    static void unwatchFile(const std::string& path);

    /**
     * @brief Check if a file is being watched
     * @param path File path to check
     * @return true if file is being watched
     */
    static bool isWatching(const std::string& path);

private:
    FileSystem() = delete;  // Static class, no instances
};

}  // namespace esengine
