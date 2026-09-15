from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import TextIO

BENIGN_STDERR_LINES = (
    "NativeSpeechRecognizer: Microphone initialized successfully.",
    "[STT] Heard:",
    "STT Engine:",
)


def is_stt_process(argv: list[str] | None = None) -> bool:
    args = argv if argv is not None else sys.argv
    return bool(args) and Path(str(args[0])).name.lower() == "speechtotext.py"


def apply_language_argument(argv: list[str] | None = None) -> str | None:
    args = argv if argv is not None else sys.argv
    if len(args) < 2 or not is_stt_process(args):
        return os.environ.get("JARVIS_INPUT_LANGUAGE")
    language = str(args[1]).strip()
    if language:
        os.environ["JARVIS_INPUT_LANGUAGE"] = language
        return language
    return os.environ.get("JARVIS_INPUT_LANGUAGE")


def is_benign_stderr_line(line: str) -> bool:
    normalized = line.strip()
    if not normalized:
        return False
    return any(normalized == marker or normalized.startswith(marker) for marker in BENIGN_STDERR_LINES)


class SttDiagnosticStream:
    """Pass through real errors while suppressing normal STT lifecycle chatter."""

    def __init__(self, stream: TextIO) -> None:
        self.stream = stream
        self._buffer = ""

    def write(self, value: str) -> int:
        self._buffer += str(value)
        while "\n" in self._buffer:
            line, self._buffer = self._buffer.split("\n", 1)
            if not is_benign_stderr_line(line):
                self.stream.write(line + "\n")
        return len(value)

    def flush(self) -> None:
        if self._buffer:
            if not is_benign_stderr_line(self._buffer):
                self.stream.write(self._buffer)
            self._buffer = ""
        self.stream.flush()

    def isatty(self) -> bool:
        return self.stream.isatty()

    def fileno(self) -> int:
        return self.stream.fileno()


def install_stt_runtime(argv: list[str] | None = None) -> bool:
    if not is_stt_process(argv):
        return False
    apply_language_argument(argv)
    if not isinstance(sys.stderr, SttDiagnosticStream):
        sys.stderr = SttDiagnosticStream(sys.stderr)
    return True
