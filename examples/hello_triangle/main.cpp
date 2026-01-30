#include <esengine/ESEngine.hpp>
#include <esengine/ui/UIContext.hpp>
#include <esengine/ui/rendering/UIBatchRenderer.hpp>
#include <esengine/ui/font/SystemFont.hpp>
#include <esengine/events/Dispatcher.hpp>

using namespace esengine;
using namespace esengine::ecs;

class HelloTriangleApp : public Application {
public:
    HelloTriangleApp() : Application(createConfig()) {}

private:
    static ApplicationConfig createConfig() {
        ApplicationConfig config;
        config.title = "ESEngine - SystemFont Demo";
        config.width = 800;
        config.height = 600;
        return config;
    }

protected:
    void onInit() override {
        ES_LOG_INFO("SystemFont Demo initialized!");

        uiContext_ = makeUnique<ui::UIContext>(getRenderContext(), dispatcher_);
        uiContext_->init();
        uiContext_->setViewport(getWidth(), getHeight());

        font_ = ui::SystemFont::create("Microsoft YaHei", 32.0f);
        if (!font_) {
            font_ = ui::SystemFont::create("Arial", 32.0f);
        }

        if (font_) {
            ES_LOG_INFO("Created SystemFont: {}", font_->getFontFamily());
            font_->preloadASCII();
            font_->preloadChars("你好世界中文测试游戏引擎");
        } else {
            ES_LOG_ERROR("Failed to create SystemFont!");
        }

        auto& registry = getRegistry();
        Entity entity = registry.create();
        registry.emplace<LocalTransform>(entity, glm::vec3(400.0f, 300.0f, 0.0f));
        registry.emplace<Name>(entity, "Demo");

        ES_LOG_INFO("Press ESC to exit");
    }

    void onUpdate(f32 deltaTime) override {
        (void)deltaTime;
        if (getInput().isKeyPressed(KeyCode::Escape)) {
            quit();
        }
    }

    void onRender() override {
        if (!uiContext_ || !font_) return;

        auto& uiRenderer = uiContext_->getRenderer();

        glm::mat4 projection = glm::ortho(
            0.0f, static_cast<f32>(getWidth()),
            static_cast<f32>(getHeight()), 0.0f,
            -1.0f, 1.0f
        );

        uiRenderer.begin(projection);

        uiRenderer.drawText(
            "ESEngine SystemFont",
            {50.0f, 50.0f},
            *font_,
            32.0f,
            {1.0f, 1.0f, 1.0f, 1.0f}
        );

        uiRenderer.drawText(
            "Hello World! 你好世界!",
            {50.0f, 100.0f},
            *font_,
            28.0f,
            {0.0f, 1.0f, 0.8f, 1.0f}
        );

        uiRenderer.drawText(
            "中文测试 Chinese Test",
            {50.0f, 150.0f},
            *font_,
            24.0f,
            {1.0f, 1.0f, 0.0f, 1.0f}
        );

        uiRenderer.drawText(
            "Small 14px text",
            {50.0f, 200.0f},
            *font_,
            14.0f,
            {0.8f, 0.8f, 1.0f, 1.0f}
        );

        uiRenderer.drawText(
            "Large 48px",
            {50.0f, 230.0f},
            *font_,
            48.0f,
            {1.0f, 0.6f, 0.6f, 1.0f}
        );

        uiRenderer.drawText(
            "游戏引擎 Game Engine",
            {50.0f, 300.0f},
            *font_,
            32.0f,
            {0.5f, 1.0f, 0.5f, 1.0f}
        );

        uiRenderer.end();
    }

    void onShutdown() override {
        font_.reset();
        uiContext_.reset();
        ES_LOG_INFO("SystemFont Demo shutdown");
    }

private:
    Dispatcher dispatcher_;
    Unique<ui::UIContext> uiContext_;
    Unique<ui::SystemFont> font_;
};

#ifndef ES_PLATFORM_WEB
int main() {
    HelloTriangleApp app;
    app.run();
    return 0;
}
#else
ES_MAIN(HelloTriangleApp)
#endif
