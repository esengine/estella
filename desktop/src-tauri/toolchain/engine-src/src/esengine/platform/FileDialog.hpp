/**
 * @file    FileDialog.hpp
 * @brief   Native file dialog utilities
 * @details Provides cross-platform file and folder selection dialogs.
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */
#pragma once

// =============================================================================
// Includes
// =============================================================================

#include "../core/Types.hpp"

#include <string>
#include <vector>

namespace esengine {

// =============================================================================
// FileFilter
// =============================================================================

struct FileFilter {
    std::string name;
    std::string pattern;
};

// =============================================================================
// FileDialog
// =============================================================================

class FileDialog {
public:
    static std::string openFile(const std::string& title = "Open File",
                                 const std::vector<FileFilter>& filters = {},
                                 const std::string& defaultPath = "");

    static std::string saveFile(const std::string& title = "Save File",
                                 const std::vector<FileFilter>& filters = {},
                                 const std::string& defaultPath = "",
                                 const std::string& defaultName = "");

    static std::string selectFolder(const std::string& title = "Select Folder",
                                     const std::string& defaultPath = "");
};

}  // namespace esengine
