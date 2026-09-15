from __future__ import annotations

import io
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "references" / "jarvisai" / "Backend"))

from stt_runtime import SttDiagnosticStream, apply_language_argument, is_benign_stderr_line, is_stt_process


def main() -> None:
    assert is_stt_process(["SpeechToText.py", "en-US"])
    assert not is_stt_process(["OtherScript.py"])
    assert is_benign_stderr_line("NativeSpeechRecognizer: Microphone initialized successfully.")
    assert is_benign_stderr_line("[STT] Heard: open youtube")
    assert is_benign_stderr_line("STT Engine: NativeSpeechRecognizer")
    assert not is_benign_stderr_line("NativeSpeechRecognizer: Google API error: network unavailable")

    original = os.environ.get("JARVIS_INPUT_LANGUAGE")
    try:
        assert apply_language_argument(["SpeechToText.py", "bn-BD"]) == "bn-BD"
        assert os.environ.get("JARVIS_INPUT_LANGUAGE") == "bn-BD"
    finally:
        if original is None:
            os.environ.pop("JARVIS_INPUT_LANGUAGE", None)
        else:
            os.environ["JARVIS_INPUT_LANGUAGE"] = original

    sink = io.StringIO()
    stream = SttDiagnosticStream(sink)
    stream.write("NativeSpeechRecognizer: Microphone initialized successfully.\n")
    stream.write("STT Engine: NativeSpeechRecognizer\n")
    stream.write("[STT] Heard: hello jarvis\n")
    stream.write("NativeSpeechRecognizer: Google API error: network unavailable\n")
    stream.flush()
    assert sink.getvalue() == "NativeSpeechRecognizer: Google API error: network unavailable\n"

    print("STT runtime regression checks passed")


if __name__ == "__main__":
    main()
