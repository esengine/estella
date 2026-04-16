#!/usr/bin/env python3
"""EHT wrapper — delegates to the eht package. Kept for backward compatibility."""

import sys
from pathlib import Path

# Ensure the tools directory is importable
sys.path.insert(0, str(Path(__file__).parent))

from eht.__main__ import main  # noqa: E402

if __name__ == '__main__':
    raise SystemExit(main())
