from __future__ import annotations

import argparse
import json
import os
import sys
import traceback
from pathlib import Path


def emit(payload: dict) -> None:
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--module-root", required=True)
    parser.add_argument("--language", default="en")
    args = parser.parse_args()
    root = Path(args.module_root).resolve()
    sys.path.insert(0, str(root))
    os.environ["JARVIS_INPUT_LANGUAGE"] = args.language
    try:
        from Backend.SpeechToText import SpeechRecognition, locale_for, _microphone
        # Open and close once before announcing readiness, so missing PyAudio or
        # an unavailable default device is reported immediately to Electron.
        with _microphone():
            pass
        emit({"event": "ready", "engine": "python-speech-recognition", "language": locale_for(args.language), "root": str(root)})
        while True:
            try:
                text = SpeechRecognition(language=args.language)
                if text:
                    emit({"event": "transcript", "text": text, "confidence": None, "engine": "python-speech-recognition"})
            except Exception as exc:
                emit({"event": "error", "message": str(exc), "category": "python-stt-runtime"})
                import time
                time.sleep(0.8)
    except KeyboardInterrupt:
        return 0
    except Exception as exc:
        emit({"event": "fatal", "message": str(exc), "category": "python-stt-startup", "trace": traceback.format_exc(limit=3)})
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
