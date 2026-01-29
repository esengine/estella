/**
 * @file    main.cpp
 * @brief   ESEngine Editor entry point
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */

#include "EditorApplication.hpp"
#include "../core/Log.hpp"
#include "../core/RuntimeConfig.hpp"

int main() {
    esengine::Log::init();

    esengine::RuntimeConfig::get().setEditorMode(true);
    esengine::RuntimeConfig::get().setHotReloadEnabled(true);

    ES_LOG_INFO("Starting ESEngine Editor...");

    esengine::editor::EditorApplication editor;
    editor.run();

    ES_LOG_INFO("ESEngine Editor exited");

    return 0;
}
