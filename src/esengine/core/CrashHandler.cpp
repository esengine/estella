/**
 * @file    CrashHandler.cpp
 * @brief   Crash handling implementation
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */

#include "CrashHandler.hpp"
#include "Log.hpp"

#include <cstdio>
#include <cstdlib>
#include <csignal>

#ifdef ES_PLATFORM_WINDOWS
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>
#include <dbghelp.h>
#pragma comment(lib, "dbghelp.lib")
#endif

namespace esengine {

std::string CrashHandler::app_name_ = "ESEngine";

// =============================================================================
// Windows Implementation
// =============================================================================

#ifdef ES_PLATFORM_WINDOWS

static std::string getExceptionCodeString(DWORD code) {
    switch (code) {
        case EXCEPTION_ACCESS_VIOLATION:
            return "Access Violation (EXCEPTION_ACCESS_VIOLATION)";
        case EXCEPTION_ARRAY_BOUNDS_EXCEEDED:
            return "Array Bounds Exceeded (EXCEPTION_ARRAY_BOUNDS_EXCEEDED)";
        case EXCEPTION_BREAKPOINT:
            return "Breakpoint (EXCEPTION_BREAKPOINT)";
        case EXCEPTION_DATATYPE_MISALIGNMENT:
            return "Datatype Misalignment (EXCEPTION_DATATYPE_MISALIGNMENT)";
        case EXCEPTION_FLT_DENORMAL_OPERAND:
            return "Float Denormal Operand (EXCEPTION_FLT_DENORMAL_OPERAND)";
        case EXCEPTION_FLT_DIVIDE_BY_ZERO:
            return "Float Divide By Zero (EXCEPTION_FLT_DIVIDE_BY_ZERO)";
        case EXCEPTION_FLT_INEXACT_RESULT:
            return "Float Inexact Result (EXCEPTION_FLT_INEXACT_RESULT)";
        case EXCEPTION_FLT_INVALID_OPERATION:
            return "Float Invalid Operation (EXCEPTION_FLT_INVALID_OPERATION)";
        case EXCEPTION_FLT_OVERFLOW:
            return "Float Overflow (EXCEPTION_FLT_OVERFLOW)";
        case EXCEPTION_FLT_STACK_CHECK:
            return "Float Stack Check (EXCEPTION_FLT_STACK_CHECK)";
        case EXCEPTION_FLT_UNDERFLOW:
            return "Float Underflow (EXCEPTION_FLT_UNDERFLOW)";
        case EXCEPTION_ILLEGAL_INSTRUCTION:
            return "Illegal Instruction (EXCEPTION_ILLEGAL_INSTRUCTION)";
        case EXCEPTION_IN_PAGE_ERROR:
            return "In Page Error (EXCEPTION_IN_PAGE_ERROR)";
        case EXCEPTION_INT_DIVIDE_BY_ZERO:
            return "Integer Divide By Zero (EXCEPTION_INT_DIVIDE_BY_ZERO)";
        case EXCEPTION_INT_OVERFLOW:
            return "Integer Overflow (EXCEPTION_INT_OVERFLOW)";
        case EXCEPTION_INVALID_DISPOSITION:
            return "Invalid Disposition (EXCEPTION_INVALID_DISPOSITION)";
        case EXCEPTION_NONCONTINUABLE_EXCEPTION:
            return "Noncontinuable Exception (EXCEPTION_NONCONTINUABLE_EXCEPTION)";
        case EXCEPTION_PRIV_INSTRUCTION:
            return "Privileged Instruction (EXCEPTION_PRIV_INSTRUCTION)";
        case EXCEPTION_SINGLE_STEP:
            return "Single Step (EXCEPTION_SINGLE_STEP)";
        case EXCEPTION_STACK_OVERFLOW:
            return "Stack Overflow (EXCEPTION_STACK_OVERFLOW)";
        default:
            return "Unknown Exception (0x" + std::to_string(code) + ")";
    }
}

static std::string captureStackTrace(CONTEXT* context) {
    std::string result;

    HANDLE process = GetCurrentProcess();
    HANDLE thread = GetCurrentThread();

    SymInitialize(process, NULL, TRUE);

    STACKFRAME64 stackFrame = {};
#ifdef _M_X64
    DWORD machineType = IMAGE_FILE_MACHINE_AMD64;
    stackFrame.AddrPC.Offset = context->Rip;
    stackFrame.AddrPC.Mode = AddrModeFlat;
    stackFrame.AddrFrame.Offset = context->Rbp;
    stackFrame.AddrFrame.Mode = AddrModeFlat;
    stackFrame.AddrStack.Offset = context->Rsp;
    stackFrame.AddrStack.Mode = AddrModeFlat;
#else
    DWORD machineType = IMAGE_FILE_MACHINE_I386;
    stackFrame.AddrPC.Offset = context->Eip;
    stackFrame.AddrPC.Mode = AddrModeFlat;
    stackFrame.AddrFrame.Offset = context->Ebp;
    stackFrame.AddrFrame.Mode = AddrModeFlat;
    stackFrame.AddrStack.Offset = context->Esp;
    stackFrame.AddrStack.Mode = AddrModeFlat;
#endif

    char symbolBuffer[sizeof(SYMBOL_INFO) + MAX_SYM_NAME * sizeof(TCHAR)];
    PSYMBOL_INFO symbol = (PSYMBOL_INFO)symbolBuffer;
    symbol->SizeOfStruct = sizeof(SYMBOL_INFO);
    symbol->MaxNameLen = MAX_SYM_NAME;

    int frameCount = 0;
    const int maxFrames = 32;

    while (frameCount < maxFrames) {
        if (!StackWalk64(machineType, process, thread, &stackFrame, context,
                         NULL, SymFunctionTableAccess64, SymGetModuleBase64, NULL)) {
            break;
        }

        if (stackFrame.AddrPC.Offset == 0) {
            break;
        }

        DWORD64 displacement = 0;
        char frameLine[512];

        if (SymFromAddr(process, stackFrame.AddrPC.Offset, &displacement, symbol)) {
            IMAGEHLP_LINE64 line = {};
            line.SizeOfStruct = sizeof(IMAGEHLP_LINE64);
            DWORD lineDisplacement = 0;

            if (SymGetLineFromAddr64(process, stackFrame.AddrPC.Offset,
                                      &lineDisplacement, &line)) {
                snprintf(frameLine, sizeof(frameLine), "  [%d] %s (%s:%lu)\n",
                         frameCount, symbol->Name, line.FileName, line.LineNumber);
            } else {
                snprintf(frameLine, sizeof(frameLine), "  [%d] %s + 0x%llx\n",
                         frameCount, symbol->Name, displacement);
            }
        } else {
            snprintf(frameLine, sizeof(frameLine), "  [%d] 0x%llx\n",
                     frameCount, stackFrame.AddrPC.Offset);
        }

        result += frameLine;
        frameCount++;
    }

    SymCleanup(process);

    if (result.empty()) {
        result = "  (Unable to capture stack trace)\n";
    }

    return result;
}

static LONG WINAPI unhandledExceptionFilter(EXCEPTION_POINTERS* exceptionInfo) {
    std::string errorType = getExceptionCodeString(exceptionInfo->ExceptionRecord->ExceptionCode);

    std::string stackTrace = captureStackTrace(exceptionInfo->ContextRecord);

    std::string message = CrashHandler::getAppName() + " has crashed!\n\n";
    message += "Error: " + errorType + "\n";
    message += "Address: 0x" + std::to_string((uintptr_t)exceptionInfo->ExceptionRecord->ExceptionAddress) + "\n\n";
    message += "Stack Trace:\n" + stackTrace;
    message += "\nThe application will now close.";

    ES_LOG_FATAL("CRASH: {}", errorType);
    ES_LOG_FATAL("Stack Trace:\n{}", stackTrace);

    MessageBoxA(NULL, message.c_str(), "Application Crash", MB_OK | MB_ICONERROR);

    return EXCEPTION_EXECUTE_HANDLER;
}

static void signalHandler(int signal) {
    const char* signalName = "Unknown";
    switch (signal) {
        case SIGABRT: signalName = "SIGABRT (Abort)"; break;
        case SIGFPE:  signalName = "SIGFPE (Floating Point Exception)"; break;
        case SIGILL:  signalName = "SIGILL (Illegal Instruction)"; break;
        case SIGSEGV: signalName = "SIGSEGV (Segmentation Fault)"; break;
    }

    std::string message = CrashHandler::getAppName() + " has crashed!\n\n";
    message += "Signal: ";
    message += signalName;
    message += "\n\nThe application will now close.";

    ES_LOG_FATAL("CRASH: Signal {}", signalName);

    MessageBoxA(NULL, message.c_str(), "Application Crash", MB_OK | MB_ICONERROR);

    std::_Exit(1);
}

void CrashHandler::init() {
    SetUnhandledExceptionFilter(unhandledExceptionFilter);

    signal(SIGABRT, signalHandler);
    signal(SIGFPE, signalHandler);
    signal(SIGILL, signalHandler);
    signal(SIGSEGV, signalHandler);

    ES_LOG_INFO("CrashHandler initialized");
}

void CrashHandler::shutdown() {
    SetUnhandledExceptionFilter(NULL);

    signal(SIGABRT, SIG_DFL);
    signal(SIGFPE, SIG_DFL);
    signal(SIGILL, SIG_DFL);
    signal(SIGSEGV, SIG_DFL);
}

void CrashHandler::setAppName(const std::string& name) {
    app_name_ = name;
}

// =============================================================================
// Other Platforms (Stub)
// =============================================================================

#else

void CrashHandler::init() {
    ES_LOG_INFO("CrashHandler: Not implemented for this platform");
}

void CrashHandler::shutdown() {
}

void CrashHandler::setAppName(const std::string& name) {
    app_name_ = name;
}

#endif

}  // namespace esengine
