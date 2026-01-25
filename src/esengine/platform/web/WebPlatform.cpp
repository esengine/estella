#include "../Platform.hpp"
#include "../../core/Log.hpp"

#ifdef ES_PLATFORM_WEB
    #include <emscripten.h>
    #include <emscripten/html5.h>
    #include <GLES3/gl3.h>
#endif

namespace esengine {

class WebPlatform : public Platform {
public:
    WebPlatform() = default;
    ~WebPlatform() override = default;

    bool initialize(u32 width, u32 height) override {
        width_ = width;
        height_ = height;
        running_ = true;

#ifdef ES_PLATFORM_WEB
        // Create WebGL context
        EmscriptenWebGLContextAttributes attrs;
        emscripten_webgl_init_context_attributes(&attrs);
        attrs.majorVersion = 2;
        attrs.minorVersion = 0;
        attrs.alpha = false;
        attrs.depth = true;
        attrs.stencil = false;
        attrs.antialias = true;
        attrs.premultipliedAlpha = true;
        attrs.preserveDrawingBuffer = false;

        context_ = emscripten_webgl_create_context("#canvas", &attrs);
        if (context_ <= 0) {
            ES_LOG_ERROR("Failed to create WebGL context");
            return false;
        }

        emscripten_webgl_make_context_current(context_);

        // Set canvas size
        emscripten_set_canvas_element_size("#canvas", width, height);

        // Get device pixel ratio
        devicePixelRatio_ = static_cast<f32>(emscripten_get_device_pixel_ratio());

        // Get actual canvas size
        f64 cssWidth, cssHeight;
        emscripten_get_element_css_size("#canvas", &cssWidth, &cssHeight);
        width_ = static_cast<u32>(cssWidth * devicePixelRatio_);
        height_ = static_cast<u32>(cssHeight * devicePixelRatio_);

        // Register event callbacks
        setupEventCallbacks();

        ES_LOG_INFO("WebPlatform initialized ({}x{}, DPR: {})", width_, height_, devicePixelRatio_);
#endif
        lastTime_ = getTime();
        return true;
    }

    void shutdown() override {
#ifdef ES_PLATFORM_WEB
        if (context_ > 0) {
            emscripten_webgl_destroy_context(context_);
            context_ = 0;
        }
#endif
        running_ = false;
        ES_LOG_INFO("WebPlatform shutdown");
    }

    void pollEvents() override {
        // Events are handled via callbacks in Emscripten
        f64 currentTime = getTime();
        deltaTime_ = currentTime - lastTime_;
        lastTime_ = currentTime;
    }

    void swapBuffers() override {
        // Emscripten handles buffer swapping automatically
    }

    f64 getTime() const override {
#ifdef ES_PLATFORM_WEB
        return emscripten_get_now() / 1000.0;
#else
        return 0.0;
#endif
    }

    f64 getDeltaTime() const override {
        return deltaTime_;
    }

    u32 getWindowWidth() const override { return width_; }
    u32 getWindowHeight() const override { return height_; }

    f32 getAspectRatio() const override {
        return height_ > 0 ? static_cast<f32>(width_) / static_cast<f32>(height_) : 1.0f;
    }

    f32 getDevicePixelRatio() const override { return devicePixelRatio_; }

    bool isRunning() const override { return running_; }
    void requestQuit() override { running_ = false; }

    void setTouchCallback(TouchCallback callback) override {
        touchCallback_ = std::move(callback);
    }

    void setKeyCallback(KeyCallback callback) override {
        keyCallback_ = std::move(callback);
    }

    void setResizeCallback(ResizeCallback callback) override {
        resizeCallback_ = std::move(callback);
    }

    // Static instance for callbacks
    static WebPlatform* instance_;

private:
    void setupEventCallbacks() {
#ifdef ES_PLATFORM_WEB
        instance_ = this;

        // Touch events
        emscripten_set_touchstart_callback("#canvas", this, true, touchCallback);
        emscripten_set_touchmove_callback("#canvas", this, true, touchCallback);
        emscripten_set_touchend_callback("#canvas", this, true, touchCallback);
        emscripten_set_touchcancel_callback("#canvas", this, true, touchCallback);

        // Mouse events (simulate touch)
        emscripten_set_mousedown_callback("#canvas", this, true, mouseCallback);
        emscripten_set_mousemove_callback("#canvas", this, true, mouseCallback);
        emscripten_set_mouseup_callback("#canvas", this, true, mouseCallback);

        // Keyboard events
        emscripten_set_keydown_callback(EMSCRIPTEN_EVENT_TARGET_DOCUMENT, this, true, keyCallback);
        emscripten_set_keyup_callback(EMSCRIPTEN_EVENT_TARGET_DOCUMENT, this, true, keyCallback);

        // Resize event
        emscripten_set_resize_callback(EMSCRIPTEN_EVENT_TARGET_WINDOW, this, true, resizeCallback);
#endif
    }

#ifdef ES_PLATFORM_WEB
    static EM_BOOL touchCallback(int eventType, const EmscriptenTouchEvent* event, void* userData) {
        auto* platform = static_cast<WebPlatform*>(userData);
        if (!platform->touchCallback_) return false;

        TouchType type;
        switch (eventType) {
        case EMSCRIPTEN_EVENT_TOUCHSTART:  type = TouchType::Begin; break;
        case EMSCRIPTEN_EVENT_TOUCHMOVE:   type = TouchType::Move; break;
        case EMSCRIPTEN_EVENT_TOUCHEND:    type = TouchType::End; break;
        case EMSCRIPTEN_EVENT_TOUCHCANCEL: type = TouchType::Cancel; break;
        default: return false;
        }

        for (int i = 0; i < event->numTouches; ++i) {
            if (event->touches[i].isChanged) {
                TouchPoint point;
                point.id = event->touches[i].identifier;
                point.x = static_cast<f32>(event->touches[i].targetX);
                point.y = static_cast<f32>(event->touches[i].targetY);
                platform->touchCallback_(type, point);
            }
        }

        return true;
    }

    static EM_BOOL mouseCallback(int eventType, const EmscriptenMouseEvent* event, void* userData) {
        auto* platform = static_cast<WebPlatform*>(userData);
        if (!platform->touchCallback_) return false;

        TouchType type;
        switch (eventType) {
        case EMSCRIPTEN_EVENT_MOUSEDOWN: type = TouchType::Begin; break;
        case EMSCRIPTEN_EVENT_MOUSEMOVE:
            if (!(event->buttons & 1)) return false;  // Only when button pressed
            type = TouchType::Move;
            break;
        case EMSCRIPTEN_EVENT_MOUSEUP: type = TouchType::End; break;
        default: return false;
        }

        TouchPoint point;
        point.id = 0;
        point.x = static_cast<f32>(event->targetX);
        point.y = static_cast<f32>(event->targetY);
        platform->touchCallback_(type, point);

        return true;
    }

    static EM_BOOL keyCallback(int eventType, const EmscriptenKeyboardEvent* event, void* userData) {
        auto* platform = static_cast<WebPlatform*>(userData);
        if (!platform->keyCallback_) return false;

        bool pressed = (eventType == EMSCRIPTEN_EVENT_KEYDOWN);
        KeyCode keyCode = static_cast<KeyCode>(event->keyCode);

        platform->keyCallback_(keyCode, pressed);
        return true;
    }

    static EM_BOOL resizeCallback(int eventType, const EmscriptenUiEvent* event, void* userData) {
        (void)eventType;
        auto* platform = static_cast<WebPlatform*>(userData);

        f64 cssWidth, cssHeight;
        emscripten_get_element_css_size("#canvas", &cssWidth, &cssHeight);

        platform->width_ = static_cast<u32>(cssWidth * platform->devicePixelRatio_);
        platform->height_ = static_cast<u32>(cssHeight * platform->devicePixelRatio_);

        emscripten_set_canvas_element_size("#canvas", platform->width_, platform->height_);

        if (platform->resizeCallback_) {
            platform->resizeCallback_(platform->width_, platform->height_);
        }

        ES_LOG_DEBUG("Window resized to {}x{}", platform->width_, platform->height_);
        return true;
    }
#endif

    u32 width_ = 0;
    u32 height_ = 0;
    f32 devicePixelRatio_ = 1.0f;
    f64 lastTime_ = 0.0;
    f64 deltaTime_ = 0.0;
    bool running_ = false;

#ifdef ES_PLATFORM_WEB
    EMSCRIPTEN_WEBGL_CONTEXT_HANDLE context_ = 0;
#endif

    TouchCallback touchCallback_;
    KeyCallback keyCallback_;
    ResizeCallback resizeCallback_;
};

WebPlatform* WebPlatform::instance_ = nullptr;

// Factory implementation
Unique<Platform> Platform::create() {
    return makeUnique<WebPlatform>();
}

}  // namespace esengine

// ========================================
// C API for JavaScript interop
// ========================================

#ifdef ES_PLATFORM_WEB
#include <emscripten/emscripten.h>

extern "C" {

static esengine::WebPlatform* g_platform = nullptr;

EMSCRIPTEN_KEEPALIVE
void es_init(int width, int height) {
    esengine::Log::init();
    g_platform = static_cast<esengine::WebPlatform*>(
        esengine::Platform::create().release()
    );
    g_platform->initialize(width, height);
    esengine::Renderer::init();
}

EMSCRIPTEN_KEEPALIVE
void es_update(float deltaTime) {
    if (g_platform) {
        g_platform->pollEvents();
    }
    (void)deltaTime;
}

EMSCRIPTEN_KEEPALIVE
void es_render() {
    esengine::Renderer::beginFrame();
    esengine::Renderer::clear();
    // Application rendering would go here
    esengine::Renderer::endFrame();
}

EMSCRIPTEN_KEEPALIVE
void es_shutdown() {
    esengine::Renderer::shutdown();
    if (g_platform) {
        g_platform->shutdown();
        delete g_platform;
        g_platform = nullptr;
    }
    esengine::Log::shutdown();
}

EMSCRIPTEN_KEEPALIVE
void es_on_touch(int type, float x, float y) {
    // Touch handling would be forwarded to the application
    (void)type;
    (void)x;
    (void)y;
}

}  // extern "C"
#endif
