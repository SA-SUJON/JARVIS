"""Reliable Python speech-to-text adapter for JARVIS.

The original implementation drove headless Chrome with
--use-fake-device-for-media-stream, which cannot capture the operator's real
microphone. This adapter uses Windows System.Speech through the shared
voice-listener.ps1 worker and keeps the original QueryModifier and translation
semantics. Electron normally owns the long-running listener; this module is for
legacy Python Main.py compatibility and direct Python use.
"""
from __future__ import annotations

import json
import os
import pathlib
import subprocess
from typing import Any

try:
    from dotenv import dotenv_values
except ImportError:
    dotenv_values = None

BASE_DIR = pathlib.Path(__file__).resolve().parents[1]
PROJECT_ROOT = BASE_DIR.parent
ENV_PATH = BASE_DIR / ".env"
ENV = dict(dotenv_values(str(ENV_PATH))) if dotenv_values and ENV_PATH.exists() else {}
InputLanguage = str(os.environ.get("InputLanguage") or ENV.get("InputLanguage") or "en")


def SetAssistantStatus(status: str) -> None:
    status_file = BASE_DIR / "Frontend" / "Files" / "Status.data"
    status_file.parent.mkdir(parents=True, exist_ok=True)
    status_file.write_text(status, encoding="utf-8")


def QueryModifier(query: str) -> str:
    new_query = str(query or "").lower().strip()
    if not new_query:
        return ""
    question_words = ["how", "what", "who", "where", "when", "why", "which", "whose", "whom", "can you", "what's", "where's", "how's"]
    punctuation = new_query[-1] if new_query else ""
    if any(word + " " in new_query for word in question_words):
        return new_query.rstrip(".!?") + "?"
    return new_query.rstrip(".!?") + "."


def UniversalTranslator(text: str) -> str:
    try:
        import mtranslate as mt
        return mt.translate(text, "en", "auto").capitalize()
    except ImportError as error:
        raise RuntimeError("mtranslate is required when InputLanguage is not English") from error


def _worker_path() -> pathlib.Path:
    candidates = [
        BASE_DIR / "voice-listener.ps1",
        PROJECT_ROOT / "public" / "voice-listener.ps1",
        pathlib.Path(__file__).resolve().parents[2] / "public" / "voice-listener.ps1",
    ]
    for candidate in candidates:
        if candidate.exists():
            return candidate
    raise FileNotFoundError("voice-listener.ps1 was not found beside the Python engine or project public directory")


def _powershell() -> str:
    if os.name != "nt":
        raise RuntimeError("Python native STT requires Windows System.Speech. On non-Windows hosts use Electron voice capture or install an offline recognizer such as Vosk/Whisper.")
    return "powershell.exe"


def SpeechRecognition(language: str | None = None, timeout: int = 60) -> str:
    requested_language = str(language or InputLanguage or "en")
    worker = _worker_path()
    process = subprocess.Popen(
        [_powershell(), "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(worker), "-Language", requested_language],
        cwd=str(worker.parent),
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
        errors="replace",
        bufsize=1,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )
    try:
        while True:
            line = process.stdout.readline() if process.stdout else ""
            if not line:
                error = process.stderr.read().strip() if process.stderr else ""
                raise RuntimeError(error or "The Windows speech worker exited without a transcript")
            try:
                event: dict[str, Any] = json.loads(line)
            except json.JSONDecodeError:
                continue
            if event.get("event") == "ready":
                SetAssistantStatus(f"Listening // {event.get('culture', requested_language)}")
            elif event.get("event") == "error":
                raise RuntimeError(str(event.get("message") or "Windows speech recognition error"))
            elif event.get("event") == "transcript" and str(event.get("text", "")).strip():
                text = str(event["text"]).strip()
                if requested_language.lower().startswith("en"):
                    return QueryModifier(text).capitalize()
                SetAssistantStatus("Translating...")
                return QueryModifier(UniversalTranslator(text))
    finally:
        try:
            process.terminate()
            process.wait(timeout=2)
        except Exception:
            process.kill()


if __name__ == "__main__":
    print(SpeechRecognition())
