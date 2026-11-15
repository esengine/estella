// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#pragma once

struct _JavaVM;

namespace eshost {

void androidTlsInit(_JavaVM* vm);

}  // namespace eshost
