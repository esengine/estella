#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
"""A second implementation of Valve's KeyValues reader, for checking ours.

The writer in build-tools/utils/vdf.js has one real consumer, steamcmd, and
steamcmd needs a Steam account to run — so it cannot be the check. This parser is
written from the format instead: quoted tokens, brace-nested sections, backslash
escapes. Nothing here imports the writer, which is the point.

    python3 verify-vdf.py <file.vdf> [--expect key=value ...]

Exits non-zero with a reason. Also asserts what a SteamPipe script must be true
of, since a syntactically fine script that uploads the wrong tree is the failure
that matters:

  * an AppBuild names every depot script it lists, and they exist beside it;
  * Preview is on (an upload nobody asked for is not recoverable by uploading
    again), unless --allow-live says the caller meant it;
  * every FileMapping is anchored — a LocalPath of "*" at a content root that
    also holds loose files would upload them all.
"""
import sys
import os


def tokenize(text):
    i, n = 0, len(text)
    while i < n:
        c = text[i]
        if c in ' \t\r\n':
            i += 1
            continue
        if c == '/' and i + 1 < n and text[i + 1] == '/':
            while i < n and text[i] != '\n':
                i += 1
            continue
        if c in '{}':
            yield c
            i += 1
            continue
        if c == '"':
            i += 1
            out = []
            while i < n and text[i] != '"':
                if text[i] == '\\' and i + 1 < n:
                    nxt = text[i + 1]
                    out.append({'n': '\n', 't': '\t'}.get(nxt, nxt))
                    i += 2
                    continue
                out.append(text[i])
                i += 1
            if i >= n:
                raise ValueError('unterminated quoted token')
            i += 1
            yield ('str', ''.join(out))
            continue
        start = i
        while i < n and text[i] not in ' \t\r\n{}"':
            i += 1
        yield ('str', text[start:i])


def parse(text):
    tokens = list(tokenize(text))
    pos = 0

    def value():
        nonlocal pos
        tok = tokens[pos]
        if tok == '{':
            pos += 1
            section = {}
            while tokens[pos] != '}':
                key = tokens[pos]
                if not isinstance(key, tuple):
                    raise ValueError(f'expected a key, got {key!r}')
                pos += 1
                section[key[1]] = value()
            pos += 1
            return section
        pos += 1
        return tok[1]

    doc = {}
    while pos < len(tokens):
        key = tokens[pos]
        if not isinstance(key, tuple):
            raise ValueError(f'expected a key at top level, got {key!r}')
        pos += 1
        doc[key[1]] = value()
    return doc


def fail(message):
    print(f'verify-vdf: {message}')
    sys.exit(1)


def main(argv):
    if not argv:
        fail('usage: verify-vdf.py <file.vdf> [--expect key=value ...] [--allow-live]')
    path = argv[0]
    expects = [a.split('=', 1) for a in argv[1:] if a.startswith('--expect=') is False and '=' in a]
    allow_live = '--allow-live' in argv

    with open(path, 'r', encoding='utf-8') as handle:
        doc = parse(handle.read())

    if len(doc) != 1:
        fail(f'expected exactly one root section, got {list(doc)}')
    root_key, root = next(iter(doc.items()))
    if not isinstance(root, dict):
        fail(f'root {root_key!r} is not a section')

    for key, want in expects:
        got = root
        for part in key.split('.'):
            if not isinstance(got, dict) or part not in got:
                fail(f'{key} is missing')
            got = got[part]
        if str(got) != want:
            fail(f'{key} is {got!r}, expected {want!r}')

    if root_key == 'AppBuild':
        if not allow_live and root.get('Preview') != '1':
            fail('AppBuild has Preview off — an upload that goes live cannot be taken back')
        if root.get('SetLive'):
            fail(f'AppBuild sets a live branch ({root["SetLive"]!r}); publishing is a separate decision')
        depots = root.get('Depots')
        if not isinstance(depots, dict) or not depots:
            fail('AppBuild lists no depots')
        for depot_id, script in depots.items():
            beside = os.path.join(os.path.dirname(os.path.abspath(path)), script)
            if not os.path.exists(beside):
                fail(f'depot {depot_id} names {script}, which is not there')
            with open(beside, 'r', encoding='utf-8') as handle:
                sub = parse(handle.read())
            config = sub.get('DepotBuildConfig')
            if not isinstance(config, dict):
                fail(f'{script} is not a DepotBuildConfig')
            if config.get('DepotID') != depot_id:
                fail(f'{script} says DepotID {config.get("DepotID")!r}, listed as {depot_id!r}')

    if root_key == 'DepotBuildConfig':
        mapping = root.get('FileMapping')
        if not isinstance(mapping, dict):
            fail('DepotBuildConfig has no FileMapping')
        local = mapping.get('LocalPath', '')
        root_dir = root.get('ContentRoot', '')
        if local == '*' and root_dir:
            loose = [e for e in os.listdir(root_dir)
                     if os.path.isfile(os.path.join(root_dir, e))]
            if loose:
                fail(f'LocalPath "*" over a content root holding loose files ({loose[:3]}) '
                     'would upload them')

    print(f'verify-vdf: {os.path.basename(path)} parses as {root_key} and holds together.')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
