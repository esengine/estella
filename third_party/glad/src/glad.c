/**
 * GLAD - Multi-Language GL/GLES/EGL/GLX/WGL Loader-Generator
 * OpenGL Core Profile 3.3 Loader Implementation
 */

/* Include Windows headers first on Windows to get APIENTRY defined */
#ifdef _WIN32
    #ifndef WIN32_LEAN_AND_MEAN
        #define WIN32_LEAN_AND_MEAN
    #endif
    #include <windows.h>
#else
    #include <dlfcn.h>
#endif

#include <glad/glad.h>

static int glad_initialized = 0;

/* =============================================================================
 * Function Pointer Definitions
 * =========================================================================== */

/* Core */
PFNGLCLEARPROC glad_glClear = NULL;
PFNGLCLEARCOLORPROC glad_glClearColor = NULL;
PFNGLCLEARDEPTHPROC glad_glClearDepth = NULL;
PFNGLVIEWPORTPROC glad_glViewport = NULL;
PFNGLSCISSORPROC glad_glScissor = NULL;
PFNGLENABLEPROC glad_glEnable = NULL;
PFNGLDISABLEPROC glad_glDisable = NULL;
PFNGLBLENDFUNCPROC glad_glBlendFunc = NULL;
PFNGLDEPTHFUNCPROC glad_glDepthFunc = NULL;
PFNGLCULLFACEPROC glad_glCullFace = NULL;
PFNGLFRONTFACEPROC glad_glFrontFace = NULL;
PFNGLDEPTHMASKPROC glad_glDepthMask = NULL;
PFNGLPOLYGONMODEPROC glad_glPolygonMode = NULL;
PFNGLGETSTRINGPROC glad_glGetString = NULL;
PFNGLGETERRORPROC glad_glGetError = NULL;
PFNGLGETINTEGERVPROC glad_glGetIntegerv = NULL;
PFNGLGETFLOATVPROC glad_glGetFloatv = NULL;
PFNGLDRAWELEMENTSPROC glad_glDrawElements = NULL;
PFNGLDRAWARRAYSPROC glad_glDrawArrays = NULL;

/* Texture */
PFNGLGENTEXTURESPROC glad_glGenTextures = NULL;
PFNGLDELETETEXTURESPROC glad_glDeleteTextures = NULL;
PFNGLBINDTEXTUREPROC glad_glBindTexture = NULL;
PFNGLTEXIMAGE2DPROC glad_glTexImage2D = NULL;
PFNGLTEXSUBIMAGE2DPROC glad_glTexSubImage2D = NULL;
PFNGLTEXPARAMETERIPROC glad_glTexParameteri = NULL;
PFNGLTEXPARAMETERFPROC glad_glTexParameterf = NULL;
PFNGLACTIVETEXTUREPROC glad_glActiveTexture = NULL;
PFNGLGENERATEMIPMAPPROC glad_glGenerateMipmap = NULL;
PFNGLPIXELSTOREIPROC glad_glPixelStorei = NULL;

/* Buffer */
PFNGLGENBUFFERSPROC glad_glGenBuffers = NULL;
PFNGLDELETEBUFFERSPROC glad_glDeleteBuffers = NULL;
PFNGLBINDBUFFERPROC glad_glBindBuffer = NULL;
PFNGLBUFFERDATAPROC glad_glBufferData = NULL;
PFNGLBUFFERSUBDATAPROC glad_glBufferSubData = NULL;
PFNGLMAPBUFFERPROC glad_glMapBuffer = NULL;
PFNGLUNMAPBUFFERPROC glad_glUnmapBuffer = NULL;

/* VAO */
PFNGLGENVERTEXARRAYSPROC glad_glGenVertexArrays = NULL;
PFNGLDELETEVERTEXARRAYSPROC glad_glDeleteVertexArrays = NULL;
PFNGLBINDVERTEXARRAYPROC glad_glBindVertexArray = NULL;
PFNGLENABLEVERTEXATTRIBARRAYPROC glad_glEnableVertexAttribArray = NULL;
PFNGLDISABLEVERTEXATTRIBARRAYPROC glad_glDisableVertexAttribArray = NULL;
PFNGLVERTEXATTRIBPOINTERPROC glad_glVertexAttribPointer = NULL;
PFNGLVERTEXATTRIBIPOINTERPROC glad_glVertexAttribIPointer = NULL;

/* Shader */
PFNGLCREATESHADERPROC glad_glCreateShader = NULL;
PFNGLDELETESHADERPROC glad_glDeleteShader = NULL;
PFNGLSHADERSOURCEPROC glad_glShaderSource = NULL;
PFNGLCOMPILESHADERPROC glad_glCompileShader = NULL;
PFNGLGETSHADERIVPROC glad_glGetShaderiv = NULL;
PFNGLGETSHADERINFOLOGPROC glad_glGetShaderInfoLog = NULL;
PFNGLCREATEPROGRAMPROC glad_glCreateProgram = NULL;
PFNGLDELETEPROGRAMPROC glad_glDeleteProgram = NULL;
PFNGLATTACHSHADERPROC glad_glAttachShader = NULL;
PFNGLDETACHSHADERPROC glad_glDetachShader = NULL;
PFNGLLINKPROGRAMPROC glad_glLinkProgram = NULL;
PFNGLUSEPROGRAMPROC glad_glUseProgram = NULL;
PFNGLGETPROGRAMIVPROC glad_glGetProgramiv = NULL;
PFNGLGETPROGRAMINFOLOGPROC glad_glGetProgramInfoLog = NULL;
PFNGLGETUNIFORMLOCATIONPROC glad_glGetUniformLocation = NULL;
PFNGLGETATTRIBLOCATIONPROC glad_glGetAttribLocation = NULL;
PFNGLBINDATTRIBLOCATIONPROC glad_glBindAttribLocation = NULL;
PFNGLUNIFORM1IPROC glad_glUniform1i = NULL;
PFNGLUNIFORM1FPROC glad_glUniform1f = NULL;
PFNGLUNIFORM2FPROC glad_glUniform2f = NULL;
PFNGLUNIFORM3FPROC glad_glUniform3f = NULL;
PFNGLUNIFORM4FPROC glad_glUniform4f = NULL;
PFNGLUNIFORM1IVPROC glad_glUniform1iv = NULL;
PFNGLUNIFORM1FVPROC glad_glUniform1fv = NULL;
PFNGLUNIFORM2FVPROC glad_glUniform2fv = NULL;
PFNGLUNIFORM3FVPROC glad_glUniform3fv = NULL;
PFNGLUNIFORM4FVPROC glad_glUniform4fv = NULL;
PFNGLUNIFORMMATRIX2FVPROC glad_glUniformMatrix2fv = NULL;
PFNGLUNIFORMMATRIX3FVPROC glad_glUniformMatrix3fv = NULL;
PFNGLUNIFORMMATRIX4FVPROC glad_glUniformMatrix4fv = NULL;

/* Framebuffer */
PFNGLGENFRAMEBUFFERSPROC glad_glGenFramebuffers = NULL;
PFNGLDELETEFRAMEBUFFERSPROC glad_glDeleteFramebuffers = NULL;
PFNGLBINDFRAMEBUFFERPROC glad_glBindFramebuffer = NULL;
PFNGLFRAMEBUFFERTEXTURE2DPROC glad_glFramebufferTexture2D = NULL;
PFNGLCHECKFRAMEBUFFERSTATUSPROC glad_glCheckFramebufferStatus = NULL;
PFNGLGENRENDERBUFFERSPROC glad_glGenRenderbuffers = NULL;
PFNGLDELETERENDERBUFFERSPROC glad_glDeleteRenderbuffers = NULL;
PFNGLBINDRENDERBUFFERPROC glad_glBindRenderbuffer = NULL;
PFNGLRENDERBUFFERSTORAGEPROC glad_glRenderbufferStorage = NULL;
PFNGLFRAMEBUFFERRENDERBUFFERPROC glad_glFramebufferRenderbuffer = NULL;
PFNGLBLITFRAMEBUFFERPROC glad_glBlitFramebuffer = NULL;

/* =============================================================================
 * Loader Implementation
 * =========================================================================== */

int gladLoaderInitialized(void) {
    return glad_initialized;
}

int gladLoadGLLoader(GLADloadproc load) {
    if (load == NULL) {
        return 0;
    }

    /* Core */
    glad_glClear = (PFNGLCLEARPROC)load("glClear");
    glad_glClearColor = (PFNGLCLEARCOLORPROC)load("glClearColor");
    glad_glClearDepth = (PFNGLCLEARDEPTHPROC)load("glClearDepth");
    glad_glViewport = (PFNGLVIEWPORTPROC)load("glViewport");
    glad_glScissor = (PFNGLSCISSORPROC)load("glScissor");
    glad_glEnable = (PFNGLENABLEPROC)load("glEnable");
    glad_glDisable = (PFNGLDISABLEPROC)load("glDisable");
    glad_glBlendFunc = (PFNGLBLENDFUNCPROC)load("glBlendFunc");
    glad_glDepthFunc = (PFNGLDEPTHFUNCPROC)load("glDepthFunc");
    glad_glCullFace = (PFNGLCULLFACEPROC)load("glCullFace");
    glad_glFrontFace = (PFNGLFRONTFACEPROC)load("glFrontFace");
    glad_glDepthMask = (PFNGLDEPTHMASKPROC)load("glDepthMask");
    glad_glPolygonMode = (PFNGLPOLYGONMODEPROC)load("glPolygonMode");
    glad_glGetString = (PFNGLGETSTRINGPROC)load("glGetString");
    glad_glGetError = (PFNGLGETERRORPROC)load("glGetError");
    glad_glGetIntegerv = (PFNGLGETINTEGERVPROC)load("glGetIntegerv");
    glad_glGetFloatv = (PFNGLGETFLOATVPROC)load("glGetFloatv");
    glad_glDrawElements = (PFNGLDRAWELEMENTSPROC)load("glDrawElements");
    glad_glDrawArrays = (PFNGLDRAWARRAYSPROC)load("glDrawArrays");

    /* Texture */
    glad_glGenTextures = (PFNGLGENTEXTURESPROC)load("glGenTextures");
    glad_glDeleteTextures = (PFNGLDELETETEXTURESPROC)load("glDeleteTextures");
    glad_glBindTexture = (PFNGLBINDTEXTUREPROC)load("glBindTexture");
    glad_glTexImage2D = (PFNGLTEXIMAGE2DPROC)load("glTexImage2D");
    glad_glTexSubImage2D = (PFNGLTEXSUBIMAGE2DPROC)load("glTexSubImage2D");
    glad_glTexParameteri = (PFNGLTEXPARAMETERIPROC)load("glTexParameteri");
    glad_glTexParameterf = (PFNGLTEXPARAMETERFPROC)load("glTexParameterf");
    glad_glActiveTexture = (PFNGLACTIVETEXTUREPROC)load("glActiveTexture");
    glad_glGenerateMipmap = (PFNGLGENERATEMIPMAPPROC)load("glGenerateMipmap");
    glad_glPixelStorei = (PFNGLPIXELSTOREIPROC)load("glPixelStorei");

    /* Buffer */
    glad_glGenBuffers = (PFNGLGENBUFFERSPROC)load("glGenBuffers");
    glad_glDeleteBuffers = (PFNGLDELETEBUFFERSPROC)load("glDeleteBuffers");
    glad_glBindBuffer = (PFNGLBINDBUFFERPROC)load("glBindBuffer");
    glad_glBufferData = (PFNGLBUFFERDATAPROC)load("glBufferData");
    glad_glBufferSubData = (PFNGLBUFFERSUBDATAPROC)load("glBufferSubData");
    glad_glMapBuffer = (PFNGLMAPBUFFERPROC)load("glMapBuffer");
    glad_glUnmapBuffer = (PFNGLUNMAPBUFFERPROC)load("glUnmapBuffer");

    /* VAO */
    glad_glGenVertexArrays = (PFNGLGENVERTEXARRAYSPROC)load("glGenVertexArrays");
    glad_glDeleteVertexArrays = (PFNGLDELETEVERTEXARRAYSPROC)load("glDeleteVertexArrays");
    glad_glBindVertexArray = (PFNGLBINDVERTEXARRAYPROC)load("glBindVertexArray");
    glad_glEnableVertexAttribArray = (PFNGLENABLEVERTEXATTRIBARRAYPROC)load("glEnableVertexAttribArray");
    glad_glDisableVertexAttribArray = (PFNGLDISABLEVERTEXATTRIBARRAYPROC)load("glDisableVertexAttribArray");
    glad_glVertexAttribPointer = (PFNGLVERTEXATTRIBPOINTERPROC)load("glVertexAttribPointer");
    glad_glVertexAttribIPointer = (PFNGLVERTEXATTRIBIPOINTERPROC)load("glVertexAttribIPointer");

    /* Shader */
    glad_glCreateShader = (PFNGLCREATESHADERPROC)load("glCreateShader");
    glad_glDeleteShader = (PFNGLDELETESHADERPROC)load("glDeleteShader");
    glad_glShaderSource = (PFNGLSHADERSOURCEPROC)load("glShaderSource");
    glad_glCompileShader = (PFNGLCOMPILESHADERPROC)load("glCompileShader");
    glad_glGetShaderiv = (PFNGLGETSHADERIVPROC)load("glGetShaderiv");
    glad_glGetShaderInfoLog = (PFNGLGETSHADERINFOLOGPROC)load("glGetShaderInfoLog");
    glad_glCreateProgram = (PFNGLCREATEPROGRAMPROC)load("glCreateProgram");
    glad_glDeleteProgram = (PFNGLDELETEPROGRAMPROC)load("glDeleteProgram");
    glad_glAttachShader = (PFNGLATTACHSHADERPROC)load("glAttachShader");
    glad_glDetachShader = (PFNGLDETACHSHADERPROC)load("glDetachShader");
    glad_glLinkProgram = (PFNGLLINKPROGRAMPROC)load("glLinkProgram");
    glad_glUseProgram = (PFNGLUSEPROGRAMPROC)load("glUseProgram");
    glad_glGetProgramiv = (PFNGLGETPROGRAMIVPROC)load("glGetProgramiv");
    glad_glGetProgramInfoLog = (PFNGLGETPROGRAMINFOLOGPROC)load("glGetProgramInfoLog");
    glad_glGetUniformLocation = (PFNGLGETUNIFORMLOCATIONPROC)load("glGetUniformLocation");
    glad_glGetAttribLocation = (PFNGLGETATTRIBLOCATIONPROC)load("glGetAttribLocation");
    glad_glBindAttribLocation = (PFNGLBINDATTRIBLOCATIONPROC)load("glBindAttribLocation");
    glad_glUniform1i = (PFNGLUNIFORM1IPROC)load("glUniform1i");
    glad_glUniform1f = (PFNGLUNIFORM1FPROC)load("glUniform1f");
    glad_glUniform2f = (PFNGLUNIFORM2FPROC)load("glUniform2f");
    glad_glUniform3f = (PFNGLUNIFORM3FPROC)load("glUniform3f");
    glad_glUniform4f = (PFNGLUNIFORM4FPROC)load("glUniform4f");
    glad_glUniform1iv = (PFNGLUNIFORM1IVPROC)load("glUniform1iv");
    glad_glUniform1fv = (PFNGLUNIFORM1FVPROC)load("glUniform1fv");
    glad_glUniform2fv = (PFNGLUNIFORM2FVPROC)load("glUniform2fv");
    glad_glUniform3fv = (PFNGLUNIFORM3FVPROC)load("glUniform3fv");
    glad_glUniform4fv = (PFNGLUNIFORM4FVPROC)load("glUniform4fv");
    glad_glUniformMatrix2fv = (PFNGLUNIFORMMATRIX2FVPROC)load("glUniformMatrix2fv");
    glad_glUniformMatrix3fv = (PFNGLUNIFORMMATRIX3FVPROC)load("glUniformMatrix3fv");
    glad_glUniformMatrix4fv = (PFNGLUNIFORMMATRIX4FVPROC)load("glUniformMatrix4fv");

    /* Framebuffer */
    glad_glGenFramebuffers = (PFNGLGENFRAMEBUFFERSPROC)load("glGenFramebuffers");
    glad_glDeleteFramebuffers = (PFNGLDELETEFRAMEBUFFERSPROC)load("glDeleteFramebuffers");
    glad_glBindFramebuffer = (PFNGLBINDFRAMEBUFFERPROC)load("glBindFramebuffer");
    glad_glFramebufferTexture2D = (PFNGLFRAMEBUFFERTEXTURE2DPROC)load("glFramebufferTexture2D");
    glad_glCheckFramebufferStatus = (PFNGLCHECKFRAMEBUFFERSTATUSPROC)load("glCheckFramebufferStatus");
    glad_glGenRenderbuffers = (PFNGLGENRENDERBUFFERSPROC)load("glGenRenderbuffers");
    glad_glDeleteRenderbuffers = (PFNGLDELETERENDERBUFFERSPROC)load("glDeleteRenderbuffers");
    glad_glBindRenderbuffer = (PFNGLBINDRENDERBUFFERPROC)load("glBindRenderbuffer");
    glad_glRenderbufferStorage = (PFNGLRENDERBUFFERSTORAGEPROC)load("glRenderbufferStorage");
    glad_glFramebufferRenderbuffer = (PFNGLFRAMEBUFFERRENDERBUFFERPROC)load("glFramebufferRenderbuffer");
    glad_glBlitFramebuffer = (PFNGLBLITFRAMEBUFFERPROC)load("glBlitFramebuffer");

    /* Check critical functions */
    if (glad_glClear == NULL || glad_glViewport == NULL || glad_glGetString == NULL) {
        return 0;
    }

    glad_initialized = 1;
    return 1;
}
