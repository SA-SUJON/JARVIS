"""Startup hook for the Backend Python runtime."""

from __future__ import annotations

import sys
from pathlib import Path

if Path(str(sys.argv[0])).name.lower() == "speechtotext.py":
    from stt_runtime import install_stt_runtime

    install_stt_runtime(sys.argv)
