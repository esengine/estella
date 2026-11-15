// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#include "ByteStream.hpp"
#include "Sockets.hpp"

#include <windows.h>

#define SECURITY_WIN32
#include <schannel.h>
#include <security.h>

#include <algorithm>
#include <cstdio>
#include <cstring>
#include <mutex>
#include <vector>

namespace eshost {
namespace {

constexpr DWORD kCredFlags = SCH_CRED_AUTO_CRED_VALIDATION | SCH_CRED_NO_DEFAULT_CREDS | SCH_USE_STRONG_CRYPTO;
constexpr DWORD kContextFlags = ISC_REQ_SEQUENCE_DETECT | ISC_REQ_REPLAY_DETECT | ISC_REQ_CONFIDENTIALITY
    | ISC_REQ_ALLOCATE_MEMORY | ISC_REQ_STREAM;
constexpr int kReadChunk = 16384;
constexpr DWORD kModernCredentialsVersion = 5;

struct ModernCredentials {
    DWORD dwVersion;
    DWORD dwCredFormat;
    DWORD cCreds;
    PCCERT_CONTEXT* paCred;
    HCERTSTORE hRootStore;
    DWORD cMappers;
    void** aphMappers;
    DWORD dwSessionLifespan;
    DWORD dwFlags;
    DWORD cTlsParameters;
    void* pTlsParameters;
};

std::wstring widen(const std::string& text) {
    const int n = MultiByteToWideChar(CP_UTF8, 0, text.data(), static_cast<int>(text.size()), nullptr, 0);
    std::wstring out(static_cast<size_t>(n), L'\0');
    MultiByteToWideChar(CP_UTF8, 0, text.data(), static_cast<int>(text.size()), out.data(), n);
    return out;
}

std::string describe(SECURITY_STATUS status) {
    switch (status) {
        case SEC_E_UNTRUSTED_ROOT: return "the certificate chain ends at an authority this machine does not trust";
        case SEC_E_WRONG_PRINCIPAL: return "the certificate is not for this host name";
        case SEC_E_CERT_EXPIRED: return "the certificate has expired";
        case SEC_E_CERT_UNKNOWN: return "the certificate could not be read";
        case SEC_E_ILLEGAL_MESSAGE: return "the server did not answer with TLS";
        case SEC_E_ALGORITHM_MISMATCH: return "the server and this machine share no TLS version or cipher";
        default: break;
    }
    char text[48];
    std::snprintf(text, sizeof text, "TLS failed (0x%08lX)", static_cast<unsigned long>(status));
    return text;
}

bool readSome(SocketHandle socket, std::vector<uint8_t>& into) {
    const size_t had = into.size();
    into.resize(had + kReadChunk);
    const int got = ::recv(socket, reinterpret_cast<char*>(into.data() + had), kReadChunk, 0);
    into.resize(had + (got > 0 ? static_cast<size_t>(got) : 0));
    return got > 0;
}

void keepExtra(std::vector<uint8_t>& bytes, const SecBuffer& buffer) {
    if (buffer.BufferType == SECBUFFER_EXTRA && buffer.cbBuffer > 0 && buffer.cbBuffer <= bytes.size()) {
        bytes.erase(bytes.begin(), bytes.end() - buffer.cbBuffer);
    } else {
        bytes.clear();
    }
}

bool acquire(CredHandle& out) {
    ModernCredentials modern{};
    modern.dwVersion = kModernCredentialsVersion;
    modern.dwFlags = kCredFlags;
    if (AcquireCredentialsHandleW(nullptr, const_cast<LPWSTR>(UNISP_NAME_W), SECPKG_CRED_OUTBOUND, nullptr,
            &modern, nullptr, nullptr, &out, nullptr) == SEC_E_OK) {
        return true;
    }
    SCHANNEL_CRED older{};
    older.dwVersion = SCHANNEL_CRED_VERSION;
    older.dwFlags = kCredFlags;
    return AcquireCredentialsHandleW(nullptr, const_cast<LPWSTR>(UNISP_NAME_W), SECPKG_CRED_OUTBOUND, nullptr,
        &older, nullptr, nullptr, &out, nullptr) == SEC_E_OK;
}

class SchannelStream final : public ByteStream {
public:
    SchannelStream(SocketHandle socket, CredHandle credentials, std::wstring target)
        : socket_(socket), credentials_(credentials), target_(std::move(target)) {}

    ~SchannelStream() override {
        if (hasContext_) DeleteSecurityContext(&context_);
        FreeCredentialsHandle(&credentials_);
        closeSocket(socket_);
    }

    SECURITY_STATUS handshake() {
        std::vector<uint8_t> incoming;
        for (;;) {
            const SECURITY_STATUS status = step(incoming);
            if (status == SEC_E_OK) {
                cipher_ = std::move(incoming);
                return QueryContextAttributesW(&context_, SECPKG_ATTR_STREAM_SIZES, &sizes_);
            }
            if (status == SEC_E_INCOMPLETE_MESSAGE || (status == SEC_I_CONTINUE_NEEDED && incoming.empty())) {
                if (!readSome(socket_, incoming)) return SEC_E_ILLEGAL_MESSAGE;
            } else if (status != SEC_I_CONTINUE_NEEDED && status != SEC_I_INCOMPLETE_CREDENTIALS) {
                return status;
            }
        }
    }

    bool sendAll(const uint8_t* data, size_t len) override {
        std::vector<uint8_t> record(sizes_.cbHeader + sizes_.cbMaximumMessage + sizes_.cbTrailer);
        while (len > 0) {
            const size_t n = std::min<size_t>(len, sizes_.cbMaximumMessage);
            std::memcpy(record.data() + sizes_.cbHeader, data, n);
            SecBuffer buffers[4] = {
                { sizes_.cbHeader, SECBUFFER_STREAM_HEADER, record.data() },
                { static_cast<unsigned long>(n), SECBUFFER_DATA, record.data() + sizes_.cbHeader },
                { sizes_.cbTrailer, SECBUFFER_STREAM_TRAILER, record.data() + sizes_.cbHeader + n },
                { 0, SECBUFFER_EMPTY, nullptr },
            };
            SecBufferDesc described{ SECBUFFER_VERSION, 4, buffers };
            {
                std::lock_guard<std::mutex> lk(contextMutex_);
                if (EncryptMessage(&context_, 0, &described, 0) != SEC_E_OK) return false;
            }
            const size_t total = buffers[0].cbBuffer + buffers[1].cbBuffer + buffers[2].cbBuffer;
            if (!sendAllSocket(socket_, record.data(), total)) return false;
            data += n;
            len -= n;
        }
        return true;
    }

    bool recvAll(uint8_t* data, size_t len) override {
        while (len > 0) {
            if (at_ == plain_.size() && !fill()) return false;
            const size_t n = std::min<size_t>(len, plain_.size() - at_);
            std::memcpy(data, plain_.data() + at_, n);
            at_ += n;
            data += n;
            len -= n;
        }
        return true;
    }

    void shutdown() override { shutdownSocket(socket_); }

private:
    SECURITY_STATUS step(std::vector<uint8_t>& incoming) {
        SecBuffer in[2] = {
            { static_cast<unsigned long>(incoming.size()), SECBUFFER_TOKEN, incoming.data() },
            { 0, SECBUFFER_EMPTY, nullptr },
        };
        SecBufferDesc inDescribed{ SECBUFFER_VERSION, 2, in };
        SecBuffer out{ 0, SECBUFFER_TOKEN, nullptr };
        SecBufferDesc outDescribed{ SECBUFFER_VERSION, 1, &out };
        DWORD got = 0;
        SECURITY_STATUS status;
        {
            std::lock_guard<std::mutex> lk(contextMutex_);
            status = InitializeSecurityContextW(&credentials_, hasContext_ ? &context_ : nullptr, target_.data(),
                kContextFlags, 0, 0, hasContext_ ? &inDescribed : nullptr, 0, &context_, &outDescribed, &got, nullptr);
        }
        if (status == SEC_E_OK || status == SEC_I_CONTINUE_NEEDED) hasContext_ = true;
        if (out.pvBuffer) {
            const bool sent = out.cbBuffer == 0
                || sendAllSocket(socket_, static_cast<const uint8_t*>(out.pvBuffer), out.cbBuffer);
            FreeContextBuffer(out.pvBuffer);
            if (!sent) return SEC_E_ILLEGAL_MESSAGE;
        }
        if (status == SEC_E_OK || status == SEC_I_CONTINUE_NEEDED) keepExtra(incoming, in[1]);
        return status;
    }

    bool fill() {
        plain_.clear();
        at_ = 0;
        for (;;) {
            if (cipher_.empty() && !readSome(socket_, cipher_)) return false;
            SecBuffer buffers[4] = {
                { static_cast<unsigned long>(cipher_.size()), SECBUFFER_DATA, cipher_.data() },
                { 0, SECBUFFER_EMPTY, nullptr }, { 0, SECBUFFER_EMPTY, nullptr }, { 0, SECBUFFER_EMPTY, nullptr },
            };
            SecBufferDesc described{ SECBUFFER_VERSION, 4, buffers };
            const SECURITY_STATUS status = DecryptMessage(&context_, &described, 0, nullptr);
            if (status == SEC_E_INCOMPLETE_MESSAGE) {
                if (!readSome(socket_, cipher_)) return false;
                continue;
            }
            if (status != SEC_E_OK && status != SEC_I_RENEGOTIATE) return false;
            SecBuffer extra{ 0, SECBUFFER_EMPTY, nullptr };
            for (const SecBuffer& buffer : buffers) {
                if (buffer.BufferType == SECBUFFER_DATA && buffer.cbBuffer > 0) {
                    const auto* bytes = static_cast<const uint8_t*>(buffer.pvBuffer);
                    plain_.assign(bytes, bytes + buffer.cbBuffer);
                } else if (buffer.BufferType == SECBUFFER_EXTRA) {
                    extra = buffer;
                }
            }
            keepExtra(cipher_, extra);
            if (status == SEC_I_RENEGOTIATE && !renegotiate()) return false;
            if (!plain_.empty()) return true;
        }
    }

    bool renegotiate() {
        for (;;) {
            const SECURITY_STATUS status = step(cipher_);
            if (status == SEC_E_OK) return true;
            if (status == SEC_E_INCOMPLETE_MESSAGE || (status == SEC_I_CONTINUE_NEEDED && cipher_.empty())) {
                if (!readSome(socket_, cipher_)) return false;
            } else if (status != SEC_I_CONTINUE_NEEDED) {
                return false;
            }
        }
    }

    SocketHandle socket_;
    CredHandle credentials_;
    CtxtHandle context_{};
    bool hasContext_ = false;
    std::wstring target_;
    std::mutex contextMutex_;
    SecPkgContext_StreamSizes sizes_{};
    std::vector<uint8_t> cipher_;
    std::vector<uint8_t> plain_;
    size_t at_ = 0;
};

}  // namespace

std::unique_ptr<ByteStream> dialTls(const std::string& host, const std::string& port, std::string& why) {
    const SocketHandle socket = dialTcp(host, port);
    if (socket == kNoSocket) {
        why = "could not connect to " + host + ":" + port;
        return nullptr;
    }
    CredHandle credentials;
    if (!acquire(credentials)) {
        closeSocket(socket);
        why = "this machine has no TLS provider to ask";
        return nullptr;
    }
    auto stream = std::make_unique<SchannelStream>(socket, credentials, widen(host));
    if (const SECURITY_STATUS status = stream->handshake(); status != SEC_E_OK) {
        why = host + ":" + port + ": " + describe(status);
        return nullptr;
    }
    return stream;
}

}  // namespace eshost
