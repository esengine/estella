/**
 * @file    UIContext.cpp
 * @brief   UIContext implementation
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */

#include "UIContext.hpp"
#include "../core/Log.hpp"
#include "../events/Dispatcher.hpp"
#include "../renderer/RenderCommand.hpp"
#include "../renderer/RenderContext.hpp"
#include "rendering/UIBatchRenderer.hpp"
#include "widgets/Widget.hpp"

#if ES_FEATURE_SDF_FONT
#include "font/SDFFont.hpp"
#include "font/MSDFFont.hpp"
#endif

#if ES_FEATURE_BITMAP_FONT
#include "font/BitmapFont.hpp"
#endif

#include <glm/gtc/matrix_transform.hpp>

namespace esengine::ui {

// =============================================================================
// Constructor / Destructor
// =============================================================================

UIContext::UIContext(RenderContext& renderContext, Dispatcher& dispatcher)
    : renderContext_(renderContext), dispatcher_(dispatcher) {}

UIContext::~UIContext() {
    if (initialized_) {
        shutdown();
    }
}

// =============================================================================
// Lifecycle
// =============================================================================

void UIContext::init() {
    if (initialized_) return;

    renderer_ = makeUnique<UIBatchRenderer>(renderContext_);
    renderer_->init();

    theme_ = Theme::createDark();

    initialized_ = true;
    ES_LOG_INFO("UIContext initialized");
}

void UIContext::shutdown() {
    if (!initialized_) return;

    root_.reset();
#if ES_FEATURE_SDF_FONT
    fonts_.clear();
    msdfFonts_.clear();
#endif
#if ES_FEATURE_BITMAP_FONT
    bitmapFonts_.clear();
#endif
    theme_.reset();

    if (renderer_) {
        renderer_->shutdown();
        renderer_.reset();
    }

    focusedWidget_ = nullptr;
    hoveredWidget_ = nullptr;
    pressedWidget_ = nullptr;

    initialized_ = false;
    ES_LOG_INFO("UIContext shutdown");
}

bool UIContext::isInitialized() const {
    return initialized_;
}

// =============================================================================
// Root Widget
// =============================================================================

void UIContext::setRoot(Unique<Widget> root) {
    if (root_) {
        root_->setContext(nullptr);
    }

    root_ = std::move(root);

    if (root_) {
        root_->setContext(this);
        root_->invalidateLayout();
    }

    focusedWidget_ = nullptr;
    hoveredWidget_ = nullptr;
    pressedWidget_ = nullptr;
}

// =============================================================================
// Theme
// =============================================================================

void UIContext::setTheme(Unique<Theme> theme) {
    if (theme) {
        theme_ = std::move(theme);
    }
}

// =============================================================================
// Font Management
// =============================================================================

#if ES_FEATURE_SDF_FONT
SDFFont* UIContext::loadFont(const std::string& name, const std::string& path, f32 fontSize,
                              f32 sdfSpread) {
    auto font = SDFFont::create(path, fontSize, sdfSpread);
    if (!font) {
        ES_LOG_ERROR("Failed to load font: {}", path);
        return nullptr;
    }

    SDFFont* ptr = font.get();
    fonts_[name] = std::move(font);

    ES_LOG_INFO("Loaded SDF font '{}' from {}", name, path);
    return ptr;
}

SDFFont* UIContext::getFont(const std::string& name) {
    auto it = fonts_.find(name);
    if (it != fonts_.end()) {
        return it->second.get();
    }
    return nullptr;
}

SDFFont* UIContext::getDefaultFont() {
    return getFont(defaultFontName_);
}

SDFFont* UIContext::getIconFont() {
    return getFont("icons");
}

MSDFFont* UIContext::loadMSDFFont(const std::string& name, const std::string& path, f32 fontSize,
                                   f32 pixelRange) {
    auto font = MSDFFont::create(path, fontSize, pixelRange);
    if (!font) {
        ES_LOG_ERROR("Failed to load MSDF font: {}", path);
        return nullptr;
    }

    MSDFFont* ptr = font.get();
    msdfFonts_[name] = std::move(font);

    ES_LOG_INFO("Loaded MSDF font '{}' from {}", name, path);
    return ptr;
}

MSDFFont* UIContext::getMSDFFont(const std::string& name) {
    auto it = msdfFonts_.find(name);
    if (it != msdfFonts_.end()) {
        return it->second.get();
    }
    return nullptr;
}

MSDFFont* UIContext::getDefaultMSDFFont() {
    return getMSDFFont(defaultFontName_);
}

MSDFFont* UIContext::getIconMSDFFont() {
    return getMSDFFont("icons");
}
#endif  // ES_FEATURE_SDF_FONT

#if ES_FEATURE_BITMAP_FONT
BitmapFont* UIContext::loadBitmapFont(const std::string& name, const std::string& atlasPath,
                                       const std::string& metricsPath) {
    auto font = BitmapFont::load(atlasPath, metricsPath);
    if (!font) {
        ES_LOG_ERROR("Failed to load bitmap font: {} / {}", atlasPath, metricsPath);
        return nullptr;
    }

    BitmapFont* ptr = font.get();
    bitmapFonts_[name] = std::move(font);

    ES_LOG_INFO("Loaded bitmap font '{}' from {}", name, atlasPath);
    return ptr;
}

BitmapFont* UIContext::getBitmapFont(const std::string& name) {
    auto it = bitmapFonts_.find(name);
    if (it != bitmapFonts_.end()) {
        return it->second.get();
    }
    return nullptr;
}

BitmapFont* UIContext::getDefaultBitmapFont() {
    return getBitmapFont(defaultFontName_);
}
#endif  // ES_FEATURE_BITMAP_FONT

// =============================================================================
// Update and Render
// =============================================================================

void UIContext::update(f32 deltaTime) {
    (void)deltaTime;

    if (!root_) return;

    doLayout();
}

void UIContext::render() {
    if (!root_ || !renderer_) {
        return;
    }

    u32 physicalWidth = static_cast<u32>(viewportWidth_ * devicePixelRatio_);
    u32 physicalHeight = static_cast<u32>(viewportHeight_ * devicePixelRatio_);

    RenderCommand::setViewport(0, 0, physicalWidth, physicalHeight);

    glm::mat4 projection = glm::ortho(0.0f, static_cast<f32>(viewportWidth_),
                                      static_cast<f32>(viewportHeight_), 0.0f, -1.0f, 1.0f);

    renderer_->begin(projection, devicePixelRatio_);
    root_->renderTree(*renderer_);
    renderer_->end();
}

void UIContext::setViewport(u32 width, u32 height) {
    if (viewportWidth_ != width || viewportHeight_ != height) {
        viewportWidth_ = width;
        viewportHeight_ = height;

        if (root_) {
            root_->invalidateLayout();
        }
    }
}

void UIContext::setDevicePixelRatio(f32 ratio) {
    devicePixelRatio_ = ratio > 0.0f ? ratio : 1.0f;
}

void UIContext::doLayout() {
    if (!root_) return;

    if (root_->isLayoutDirty()) {
        Rect rootBounds(0.0f, 0.0f, static_cast<f32>(viewportWidth_),
                        static_cast<f32>(viewportHeight_));

        root_->measure(rootBounds.width, rootBounds.height);
        root_->layout(rootBounds);
    }
}

// =============================================================================
// Input Processing
// =============================================================================

void UIContext::processMouseMove(f32 x, f32 y) {
    f32 deltaX = x - lastMouseX_;
    f32 deltaY = y - lastMouseY_;
    lastMouseX_ = x;
    lastMouseY_ = y;

    updateHoveredWidget(x, y);

    if (pressedWidget_) {
        MouseMoveEvent event;
        event.x = x;
        event.y = y;
        event.deltaX = deltaX;
        event.deltaY = deltaY;
        event.leftButton = mouseButtonDown_[static_cast<usize>(MouseButton::Left)];
        event.rightButton = mouseButtonDown_[static_cast<usize>(MouseButton::Right)];
        event.middleButton = mouseButtonDown_[static_cast<usize>(MouseButton::Middle)];

        pressedWidget_->onMouseMove(event);
    } else if (hoveredWidget_) {
        MouseMoveEvent event;
        event.x = x;
        event.y = y;
        event.deltaX = deltaX;
        event.deltaY = deltaY;

        hoveredWidget_->onMouseMove(event);
    }
}

void UIContext::processMouseDown(MouseButton button, f32 x, f32 y) {
    mouseButtonDown_[static_cast<usize>(button)] = true;
    lastMouseX_ = x;
    lastMouseY_ = y;

    updateHoveredWidget(x, y);

    if (hoveredWidget_) {
        pressedWidget_ = hoveredWidget_;

        if (hoveredWidget_->isFocusable()) {
            setFocus(hoveredWidget_);
        }

        MouseButtonEvent event;
        event.button = button;
        event.pressed = true;
        event.x = x;
        event.y = y;

        hoveredWidget_->onMouseDown(event);
    } else {
        setFocus(nullptr);
    }
}

void UIContext::processMouseUp(MouseButton button, f32 x, f32 y) {
    mouseButtonDown_[static_cast<usize>(button)] = false;
    lastMouseX_ = x;
    lastMouseY_ = y;

    Widget* targetWidget = pressedWidget_ ? pressedWidget_ : hoveredWidget_;

    if (targetWidget) {
        MouseButtonEvent event;
        event.button = button;
        event.pressed = false;
        event.x = x;
        event.y = y;

        targetWidget->onMouseUp(event);
    }

    if (button == MouseButton::Left) {
        pressedWidget_ = nullptr;
    }

    updateHoveredWidget(x, y);
}

void UIContext::processMouseScroll(f32 deltaX, f32 deltaY, f32 x, f32 y) {
    updateHoveredWidget(x, y);

    if (hoveredWidget_) {
        ScrollEvent event;
        event.deltaX = deltaX;
        event.deltaY = deltaY;
        event.x = x;
        event.y = y;

        Widget* target = hoveredWidget_;
        while (target) {
            if (target->onScroll(event)) {
                break;
            }
            target = target->getParent();
        }
    }
}

void UIContext::processKeyDown(KeyCode key, bool ctrl, bool shift, bool alt) {
    if (focusedWidget_) {
        KeyEvent event;
        event.key = key;
        event.pressed = true;
        event.ctrl = ctrl;
        event.shift = shift;
        event.alt = alt;

        focusedWidget_->onKeyDown(event);
    }
}

void UIContext::processKeyUp(KeyCode key, bool ctrl, bool shift, bool alt) {
    if (focusedWidget_) {
        KeyEvent event;
        event.key = key;
        event.pressed = false;
        event.ctrl = ctrl;
        event.shift = shift;
        event.alt = alt;

        focusedWidget_->onKeyUp(event);
    }
}

void UIContext::processTextInput(const std::string& text) {
    if (focusedWidget_ && !text.empty()) {
        TextInputEvent event;
        event.text = text;
        event.codepoint = static_cast<u32>(text[0]);

        focusedWidget_->onTextInput(event);
    }
}

// =============================================================================
// Focus Management
// =============================================================================

void UIContext::setFocus(Widget* widget) {
    if (focusedWidget_ == widget) return;

    if (focusedWidget_) {
        BlurEvent blurEvent;
        focusedWidget_->setFocused(false);
        focusedWidget_->onBlur(blurEvent);
    }

    focusedWidget_ = widget;

    if (focusedWidget_) {
        FocusEvent focusEvent;
        focusedWidget_->setFocused(true);
        focusedWidget_->onFocus(focusEvent);
    }
}

// =============================================================================
// Internal
// =============================================================================

void UIContext::updateHoveredWidget(f32 x, f32 y) {
    Widget* newHovered = root_ ? root_->hitTest(x, y) : nullptr;

    if (newHovered != hoveredWidget_) {
        if (hoveredWidget_) {
            MouseLeaveEvent leaveEvent;
            hoveredWidget_->onMouseLeave(leaveEvent);

            if (!pressedWidget_) {
                hoveredWidget_->setState(false, false);
            }
        }

        hoveredWidget_ = newHovered;

        if (hoveredWidget_) {
            MouseEnterEvent enterEvent;
            enterEvent.x = x;
            enterEvent.y = y;
            hoveredWidget_->onMouseEnter(enterEvent);

            if (!pressedWidget_ || pressedWidget_ == hoveredWidget_) {
                hoveredWidget_->setState(true, false);
            }
        }
    }
}

// =============================================================================
// Clipboard
// =============================================================================

void UIContext::setClipboardText(const std::string& text) {
    clipboardText_ = text;

    // TODO: Integrate with platform clipboard when available
    // Platform::setClipboard(text);
}

std::string UIContext::getClipboardText() const {
    // TODO: Integrate with platform clipboard when available
    // return Platform::getClipboard();

    return clipboardText_;
}

}  // namespace esengine::ui
