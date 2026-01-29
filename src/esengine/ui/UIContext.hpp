/**
 * @file    UIContext.hpp
 * @brief   Central UI coordinator
 * @details Manages the UI widget tree, themes, fonts, input processing,
 *          and rendering coordination.
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
#include "../platform/Platform.hpp"
#include "core/Theme.hpp"
#include "core/Types.hpp"

#include <glm/glm.hpp>

#include <string>
#include <unordered_map>
#include <vector>

namespace esengine {

class RenderContext;
class Dispatcher;

namespace ui {

#if ES_FEATURE_SDF_FONT
class SDFFont;
class MSDFFont;
#endif

#if ES_FEATURE_BITMAP_FONT
class BitmapFont;
#endif

class UIBatchRenderer;
class Widget;

#if ES_FEATURE_SDF_FONT
using Font = SDFFont;
#elif ES_FEATURE_BITMAP_FONT
using Font = BitmapFont;
#endif

// =============================================================================
// UIContext Class
// =============================================================================

/**
 * @brief Central coordinator for the UI system
 *
 * @details Manages the complete UI lifecycle including:
 *          - Widget tree management
 *          - Theme and font management
 *          - Input event processing
 *          - Rendering coordination
 *
 * @code
 * UIContext ui(renderContext, dispatcher);
 * ui.init();
 * ui.loadFont("default", "assets/fonts/Roboto.ttf");
 *
 * auto root = makeUnique<Panel>("root");
 * root->addChild(makeUnique<Button>("btn", "Click Me"));
 * ui.setRoot(std::move(root));
 *
 * // In game loop:
 * ui.update(deltaTime);
 * ui.render();
 * @endcode
 */
class UIContext {
public:
    UIContext(RenderContext& renderContext, Dispatcher& dispatcher);
    ~UIContext();

    // Non-copyable
    UIContext(const UIContext&) = delete;
    UIContext& operator=(const UIContext&) = delete;

    // =========================================================================
    // Lifecycle
    // =========================================================================

    /**
     * @brief Initializes the UI context
     */
    void init();

    /**
     * @brief Shuts down the UI context
     */
    void shutdown();

    /**
     * @brief Returns true if initialized
     */
    bool isInitialized() const;

    // =========================================================================
    // Root Widget
    // =========================================================================

    /**
     * @brief Sets the root widget of the UI tree
     * @param root The root widget (ownership transferred)
     */
    void setRoot(Unique<Widget> root);

    /**
     * @brief Gets the root widget
     */
    Widget* getRoot() { return root_.get(); }

    /**
     * @brief Gets the root widget (const)
     */
    const Widget* getRoot() const { return root_.get(); }

    // =========================================================================
    // Theme
    // =========================================================================

    /**
     * @brief Sets the UI theme
     * @param theme New theme (ownership transferred)
     */
    void setTheme(Unique<Theme> theme);

    /**
     * @brief Gets the current theme
     */
    Theme& getTheme() { return *theme_; }

    /**
     * @brief Gets the current theme (const)
     */
    const Theme& getTheme() const { return *theme_; }

    // =========================================================================
    // Font Management
    // =========================================================================

#if ES_FEATURE_SDF_FONT
    /**
     * @brief Loads a font from file (uses SDF rendering)
     */
    SDFFont* loadFont(const std::string& name, const std::string& path, f32 fontSize = 48.0f,
                      f32 sdfSpread = 8.0f);

    SDFFont* getFont(const std::string& name);
    SDFFont* getDefaultFont();
    SDFFont* getIconFont();

    /**
     * @brief Loads a font from file (uses MSDF rendering for sharper text)
     */
    MSDFFont* loadMSDFFont(const std::string& name, const std::string& path, f32 fontSize = 32.0f,
                            f32 pixelRange = 4.0f);

    MSDFFont* getMSDFFont(const std::string& name);
    MSDFFont* getDefaultMSDFFont();
    MSDFFont* getIconMSDFFont();
#endif

#if ES_FEATURE_BITMAP_FONT
    /**
     * @brief Loads a bitmap font from atlas and metrics files
     */
    BitmapFont* loadBitmapFont(const std::string& name, const std::string& atlasPath,
                                const std::string& metricsPath);

    BitmapFont* getBitmapFont(const std::string& name);
    BitmapFont* getDefaultBitmapFont();
#endif

    void setDefaultFontName(const std::string& name) { defaultFontName_ = name; }

    // =========================================================================
    // Update and Render
    // =========================================================================

    /**
     * @brief Updates the UI
     * @param deltaTime Time since last update in seconds
     */
    void update(f32 deltaTime);

    /**
     * @brief Renders the UI
     */
    void render();

    /**
     * @brief Sets the viewport size
     * @param width Viewport width in logical pixels
     * @param height Viewport height in logical pixels
     */
    void setViewport(u32 width, u32 height);

    /**
     * @brief Sets the device pixel ratio for high-DPI displays
     * @param ratio Pixel ratio (1.0 for standard, 2.0 for retina, etc.)
     */
    void setDevicePixelRatio(f32 ratio);

    /**
     * @brief Gets the device pixel ratio
     */
    f32 getDevicePixelRatio() const { return devicePixelRatio_; }

    /**
     * @brief Gets the viewport size
     */
    glm::vec2 getViewportSize() const { return {viewportWidth_, viewportHeight_}; }

    /**
     * @brief Gets the current mouse position
     */
    glm::vec2 getMousePosition() const { return {lastMouseX_, lastMouseY_}; }

    // =========================================================================
    // Input Processing
    // =========================================================================

    /**
     * @brief Processes mouse movement
     * @param x Mouse X position
     * @param y Mouse Y position
     */
    void processMouseMove(f32 x, f32 y);

    /**
     * @brief Processes mouse button press
     * @param button Mouse button
     * @param x Mouse X position
     * @param y Mouse Y position
     */
    void processMouseDown(MouseButton button, f32 x, f32 y);

    /**
     * @brief Processes mouse button release
     * @param button Mouse button
     * @param x Mouse X position
     * @param y Mouse Y position
     */
    void processMouseUp(MouseButton button, f32 x, f32 y);

    /**
     * @brief Processes mouse scroll
     * @param deltaX Horizontal scroll amount
     * @param deltaY Vertical scroll amount
     * @param x Mouse X position
     * @param y Mouse Y position
     */
    void processMouseScroll(f32 deltaX, f32 deltaY, f32 x, f32 y);

    /**
     * @brief Processes key press
     * @param key Key code
     * @param ctrl Control modifier
     * @param shift Shift modifier
     * @param alt Alt modifier
     */
    void processKeyDown(KeyCode key, bool ctrl, bool shift, bool alt);

    /**
     * @brief Processes key release
     * @param key Key code
     * @param ctrl Control modifier
     * @param shift Shift modifier
     * @param alt Alt modifier
     */
    void processKeyUp(KeyCode key, bool ctrl, bool shift, bool alt);

    /**
     * @brief Processes text input
     * @param text Input text
     */
    void processTextInput(const std::string& text);

    // =========================================================================
    // Focus Management
    // =========================================================================

    /**
     * @brief Gets the currently focused widget
     */
    Widget* getFocusedWidget() { return focusedWidget_; }

    /**
     * @brief Sets focus to a widget
     * @param widget Widget to focus (nullptr to clear focus)
     */
    void setFocus(Widget* widget);

    /**
     * @brief Clears focus from all widgets
     */
    void clearFocus() { setFocus(nullptr); }

    /**
     * @brief Clears all references to a widget (called when widget is destroyed)
     * @param widget Widget being destroyed
     */
    void clearWidgetReferences(Widget* widget);

    // =========================================================================
    // Overlay Management
    // =========================================================================

    /**
     * @brief Adds an overlay widget (rendered on top of everything)
     * @param overlay Widget to add as overlay
     */
    void addOverlay(Widget* overlay);

    /**
     * @brief Removes an overlay widget
     * @param overlay Widget to remove
     */
    void removeOverlay(Widget* overlay);

    /**
     * @brief Checks if any overlay is currently active
     */
    bool hasActiveOverlay() const { return !overlays_.empty(); }

    // =========================================================================
    // Clipboard
    // =========================================================================

    /**
     * @brief Sets the clipboard text
     * @param text Text to copy to clipboard
     */
    void setClipboardText(const std::string& text);

    /**
     * @brief Gets the clipboard text
     * @return Current clipboard text
     */
    std::string getClipboardText() const;

    // =========================================================================
    // Renderer Access
    // =========================================================================

    /**
     * @brief Gets the UI batch renderer
     */
    UIBatchRenderer& getRenderer() { return *renderer_; }

    /**
     * @brief Gets the render context
     */
    RenderContext& getRenderContext() { return renderContext_; }

    /**
     * @brief Gets the event dispatcher
     */
    Dispatcher& getDispatcher() { return dispatcher_; }

private:
    void updateHoveredWidget(f32 x, f32 y);
    void doLayout();

    RenderContext& renderContext_;
    Dispatcher& dispatcher_;

    Unique<UIBatchRenderer> renderer_;
    Unique<Widget> root_;
    Unique<Theme> theme_;

#if ES_FEATURE_SDF_FONT
    std::unordered_map<std::string, Unique<SDFFont>> fonts_;
    std::unordered_map<std::string, Unique<MSDFFont>> msdfFonts_;
#endif

#if ES_FEATURE_BITMAP_FONT
    std::unordered_map<std::string, Unique<BitmapFont>> bitmapFonts_;
#endif

    std::string defaultFontName_ = "default";

    u32 viewportWidth_ = 0;
    u32 viewportHeight_ = 0;
    f32 devicePixelRatio_ = 1.0f;

    Widget* focusedWidget_ = nullptr;
    Widget* hoveredWidget_ = nullptr;
    Widget* pressedWidget_ = nullptr;

    f32 lastMouseX_ = 0.0f;
    f32 lastMouseY_ = 0.0f;
    bool mouseButtonDown_[static_cast<usize>(MouseButton::Count)] = {};

    std::string clipboardText_;

    std::vector<Widget*> overlays_;

    bool initialized_ = false;
};

}  // namespace ui
}  // namespace esengine
