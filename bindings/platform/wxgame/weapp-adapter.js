// WeChat MiniGame Adapter
// Provides browser-like APIs for compatibility with Emscripten

// Canvas polyfill
if (typeof canvas === 'undefined') {
    var canvas = wx.createCanvas();
}

// Window object polyfill
if (typeof window === 'undefined') {
    var window = {
        innerWidth: canvas.width,
        innerHeight: canvas.height,
        devicePixelRatio: wx.getSystemInfoSync().pixelRatio,
        performance: {
            now: function() {
                return Date.now();
            }
        },
        addEventListener: function(type, listener, options) {
            if (type === 'resize') {
                // WeChat doesn't support resize events in the same way
            }
        },
        removeEventListener: function(type, listener, options) {}
    };
}

// Document polyfill
if (typeof document === 'undefined') {
    var document = {
        createElement: function(tagName) {
            if (tagName === 'canvas') {
                return wx.createCanvas();
            }
            return {};
        },
        getElementById: function(id) {
            if (id === 'canvas') {
                return canvas;
            }
            return null;
        },
        body: {
            appendChild: function() {}
        },
        addEventListener: function(type, listener, options) {},
        removeEventListener: function(type, listener, options) {}
    };
}

// Performance polyfill
if (typeof performance === 'undefined') {
    var performance = {
        now: function() {
            return Date.now();
        }
    };
}

// Console polyfill (WeChat has console but ensure it exists)
if (typeof console === 'undefined') {
    var console = {
        log: function() {},
        error: function() {},
        warn: function() {},
        info: function() {}
    };
}

// XMLHttpRequest polyfill for asset loading
if (typeof XMLHttpRequest === 'undefined') {
    var XMLHttpRequest = function() {
        this.readyState = 0;
        this.status = 0;
        this.responseText = '';
        this.response = null;
    };

    XMLHttpRequest.prototype.open = function(method, url, async) {
        this._method = method;
        this._url = url;
        this._async = async;
    };

    XMLHttpRequest.prototype.send = function(data) {
        var self = this;
        var fs = wx.getFileSystemManager();

        if (this._method === 'GET') {
            try {
                // Try to read as a local file first
                var content = fs.readFileSync(this._url);
                self.status = 200;
                self.readyState = 4;
                self.response = content;
                self.responseText = typeof content === 'string' ? content : '';
                if (self.onload) self.onload();
            } catch (e) {
                // If local read fails, try network
                wx.request({
                    url: this._url,
                    method: 'GET',
                    responseType: 'arraybuffer',
                    success: function(res) {
                        self.status = res.statusCode;
                        self.readyState = 4;
                        self.response = res.data;
                        if (self.onload) self.onload();
                    },
                    fail: function(err) {
                        self.status = 0;
                        self.readyState = 4;
                        if (self.onerror) self.onerror(err);
                    }
                });
            }
        }
    };

    XMLHttpRequest.prototype.setRequestHeader = function(name, value) {};
}

// Image polyfill
if (typeof Image === 'undefined') {
    var Image = function() {
        var img = wx.createImage();
        return img;
    };
}

// Audio polyfill
if (typeof Audio === 'undefined') {
    var Audio = function(src) {
        var audio = wx.createInnerAudioContext();
        if (src) {
            audio.src = src;
        }
        return audio;
    };
}

// Export for module use
if (typeof module !== 'undefined') {
    module.exports = {
        window: window,
        document: document,
        canvas: canvas,
        performance: performance
    };
}
