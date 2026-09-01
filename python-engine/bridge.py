#!/usr/bin/env python3
"""JARVIS Python engine bridge.

Electron sends one JSON request per process invocation and receives one JSON response.
The legacy PyQt GUI is intentionally not imported; Electron owns the interface while
this bridge preserves the legacy backend modules and their configuration contract.
"""
from __future__ import annotations

import asyncio
import base64
import importlib
import json
import os
import pathlib
import sys
import tempfile
import traceback
from typing import Any

BASE_DIR = pathlib.Path(__file__).resolve().parent
os.chdir(BASE_DIR)
sys.path.insert(0, str(BASE_DIR))

DEFAULTS = {
    "CohereAPIKey": "",
    "GroqAPIKey": "",
    "HuggingFaceAPIKey": "",
    "Username": "SA SUJON",
    "Assistantname": "JARVIS",
    "InputLanguage": "en",
    "AssistantVoice": "en-CA-LiamNeural",
}

_loaded_config: dict[str, Any] | None = None
_modules: dict[str, Any] = {}


def _read_defaults() -> dict[str, str]:
    result = dict(DEFAULTS)
    env_file = BASE_DIR / ".env"
    if env_file.exists():
        for raw in env_file.read_text(encoding="utf-8").splitlines():
            if "=" not in raw or raw.strip().startswith("#"):
                continue
            key, value = raw.split("=", 1)
            result[key.strip()] = value.strip().strip("\"'")
    return result


def _configure(settings: dict[str, Any] | None) -> dict[str, str]:
    global _loaded_config, _modules
    settings = settings or {}
    python_cfg = settings.get("pythonEngine") or settings
    api_keys = python_cfg.get("apiKeys") or {}
    values = _read_defaults()
    values.update({
        "Username": str(python_cfg.get("userName") or values["Username"]),
        "Assistantname": str(python_cfg.get("assistantName") or values["Assistantname"]),
        "InputLanguage": str(python_cfg.get("inputLanguage") or values["InputLanguage"]),
        "AssistantVoice": str(python_cfg.get("assistantVoice") or values["AssistantVoice"]),
    })
    for key in ("CohereAPIKey", "GroqAPIKey", "HuggingFaceAPIKey"):
        values[key] = str(api_keys.get(key) or python_cfg.get(key) or values.get(key, ""))
        os.environ[key] = values[key]
    for key, value in values.items():
        os.environ[key] = value

    # Legacy modules call dotenv_values('.env') at import time. Feed them the
    # encrypted Electron settings in memory instead of writing API keys to disk.
    try:
        import dotenv
        original = getattr(dotenv, "dotenv_values")
        def configured_values(dotenv_path=None, *args, **kwargs):
            if dotenv_path in (None, ".env") or (isinstance(dotenv_path, str) and dotenv_path.endswith(".env")):
                return dict(values)
            return original(dotenv_path, *args, **kwargs)
        dotenv.dotenv_values = configured_values
    except Exception:
        pass

    signature = json.dumps(values, sort_keys=True)
    if signature != _loaded_config:
        for module_name in [
            "Backend.Model", "Backend.Chatbot", "Backend.RealtimeSearchEngine", "Backend.Automation", "Backend.TextToSpeech"
        ]:
            sys.modules.pop(module_name, None)
        _modules = {}
        _loaded_config = signature
    return values


def _load(module: str):
    if module not in _modules:
        _modules[module] = importlib.import_module(module)
    return _modules[module]


def _query_modifier(query: str) -> str:
    text = query.lower().strip()
    if not text:
        return text
    question_words = ["how", "what", "who", "where", "when", "why", "which", "whose", "whom", "can you", "what's", "where's", "how's"]
    if any(word + " " in text for word in question_words):
        return text.rstrip(".!?") + "?"
    return text.rstrip(".!?") + "."


def _decision(query: str) -> list[str]:
    return list(_load("Backend.Model").FirstLayerDMM(query))


def _chat(query: str) -> str:
    return str(_load("Backend.Chatbot").ChatBot(_query_modifier(query)))


def _realtime(query: str) -> str:
    return str(_load("Backend.RealtimeSearchEngine").RealtimeSearchEngine(_query_modifier(query)))


def _automation(tasks: list[str]) -> dict[str, Any]:
    result = asyncio.run(_load("Backend.Automation").Automation(tasks))
    return {"ok": True, "result": result, "tasks": tasks}


def _python_tts(text: str, voice: str, pitch: str = "+5Hz", rate: str = "+13%") -> dict[str, Any]:
    async def generate() -> bytes:
        import edge_tts
        communicate = edge_tts.Communicate(text, voice, pitch=pitch, rate=rate)
        chunks: list[bytes] = []
        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                chunks.append(chunk["data"])
        return b"".join(chunks)
    audio = asyncio.run(generate())
    return {"source": "python-edge-tts", "voice": voice, "mime": "audio/mpeg", "dataUrl": "data:audio/mpeg;base64," + base64.b64encode(audio).decode("ascii")}


def _image(prompt: str) -> dict[str, Any]:
    import random
    import requests
    token = os.environ.get("HuggingFaceAPIKey", "")
    if not token:
        raise RuntimeError("HuggingFaceAPIKey is not configured")
    output_dir = BASE_DIR / "Data"
    output_dir.mkdir(exist_ok=True)
    safe = "".join(char if char.isalnum() or char in "-_" else "_" for char in prompt).strip("_")[:80] or "jarvis_image"
    response_files = []
    for index in range(1, 5):
        response = requests.post("https://api-inference.huggingface.co/models/stabilityai/stable-diffusion-xl-base-1.0", headers={"Authorization": f"Bearer {token}"}, json={"inputs": f"{prompt}, quality=4K, sharpness=maximum, high resolution, seed={random.randint(0, 1000000)}"}, timeout=120)
        response.raise_for_status()
        file_path = output_dir / f"{safe}{index}.jpg"
        file_path.write_bytes(response.content)
        response_files.append(str(file_path))
    return {"ok": True, "files": response_files, "prompt": prompt}


def handle(request: dict[str, Any]) -> dict[str, Any]:
    settings = request.get("settings") or {}
    values = _configure(settings)
    action = request.get("action")
    if action == "health":
        packages: dict[str, bool] = {}
        for package in ("cohere", "groq", "edge_tts", "requests", "dotenv"):
            try:
                importlib.import_module(package)
                packages[package] = True
            except Exception:
                packages[package] = False
        return {"ok": True, "python": sys.version.split()[0], "engineRoot": str(BASE_DIR), "packages": packages, "defaults": {"userName": values["Username"], "assistantName": values["Assistantname"], "inputLanguage": values["InputLanguage"], "assistantVoice": values["AssistantVoice"]}, "features": {"decision": packages["cohere"], "chat": packages["groq"], "realtime": packages["groq"], "automation": packages["groq"], "pythonTts": packages["edge_tts"], "imageGeneration": packages["requests"] and bool(values["HuggingFaceAPIKey"])}}
    if action == "decision": return {"ok": True, "decision": _decision(str(request.get("query", "")))}
    if action == "chat": return {"ok": True, "answer": _chat(str(request.get("query", "")))}
    if action == "realtime": return {"ok": True, "answer": _realtime(str(request.get("query", "")))}
    if action == "route":
        query = str(request.get("query", "")); decision = _decision(query); tasks = [item for item in decision if any(item.startswith(prefix) for prefix in ("open ", "close ", "play ", "system ", "content ", "duckduckgo search ", "web search ", "google search ", "search ", "youtube search "))]
        if tasks: _automation(tasks)
        if any(item.startswith("realtime ") for item in decision): answer = _realtime(query)
        elif any(item.startswith("general ") for item in decision): answer = _chat(next(item.removeprefix("general ") for item in decision if item.startswith("general ")))
        else: answer = "Command routed successfully."
        return {"ok": True, "decision": decision, "answer": answer, "tasks": tasks}
    if action == "automation": return _automation(list(request.get("tasks") or []))
    if action == "tts": return _python_tts(str(request.get("text", "")), str(request.get("voice") or values["AssistantVoice"]), str(request.get("pitch") or "+5Hz"), str(request.get("rate") or "+13%"))
    if action == "stt":
        from Backend.SpeechToText import SpeechRecognition
        return {"ok": True, "text": SpeechRecognition(str(request.get("language") or values["InputLanguage"]))}
    if action == "image": return _image(str(request.get("prompt", "")))
    if action == "legacy-contract": return {"ok": True, "statusFiles": ["Frontend/Files/Mic.data", "Frontend/Files/Status.data", "Frontend/Files/Responses.data", "Frontend/Files/Database.data"], "stt": "Repaired Python System.Speech adapter using voice-listener.ps1; Electron native listener remains available for the desktop UI.", "tts": "python-edge-tts"}
    raise RuntimeError(f"Unknown Python engine action: {action}")


def main() -> None:
    try:
        request = json.loads(sys.stdin.read() or "{}")
        print(json.dumps(handle(request), ensure_ascii=False), flush=True)
    except Exception as error:
        print(json.dumps({"ok": False, "error": str(error), "trace": traceback.format_exc(limit=4)}, ensure_ascii=False), flush=True)
        sys.exit(1)


if __name__ == "__main__":
    main()
