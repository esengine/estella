// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
//
// The whole app target: the window, the view, the engine and the game all live in
// libestella_ios.a (native/js/main_ios.mm). This is only an entry point, so the
// Xcode project stays a signing + packaging shell.

extern int EstellaRunApp(int argc, char** argv);

int main(int argc, char** argv) {
    return EstellaRunApp(argc, argv);
}
