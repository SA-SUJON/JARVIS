from __future__ import annotations

import asyncio
import contextlib
import importlib
import io
import json
import os
import sys
import traceback
import base64
import wave
from pathlib import Path
from typing import Any

ROOT = Path.cwd()
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

_CONFIG_VERSION: str | None = None
_VOICE_ENCODER: Any = None


def _safe_text(value: Any) -> str:
    return str(value).replace("\x00", "").strip()


def _configure(config: dict[str, Any]) -> dict[str, Any]:
    global _CONFIG_VERSION
    providers = config.get("providers") or []
    keys: dict[str, str] = {}
    for provider in providers:
        p_id = str(provider.get("id"))
        p_key = provider.get("key")
        p_keys = provider.get("keys")
        if p_keys and isinstance(p_keys, list):
            keys[p_id] = ",".join(str(k).strip() for k in p_keys if str(k).strip())
        elif p_key:
            keys[p_id] = str(p_key).strip()

    # If explicit geminiKeys array is passed
    if config.get("geminiKeys") and isinstance(config.get("geminiKeys"), list):
        keys["gemini"] = ",".join(str(k).strip() for k in config["geminiKeys"] if str(k).strip())

    values = {
        "Username": _safe_text(config.get("userName") or "SA SUJON"),
        "Assistantname": _safe_text(config.get("assistantName") or "JARVIS"),
        "InputLanguage": _safe_text(config.get("language") or "en"),
        "AssistantVoice": _safe_text(config.get("voice") or "en-CA-LiamNeural"),
        "GeminiAPIKeys": keys.get("gemini", ""),
        "GeminiAPIKey": keys.get("gemini", "").split(",")[0].strip() if keys.get("gemini") else "",
        "OpenAIAPIKey": keys.get("openai", ""),
        "AnthropicAPIKey": keys.get("anthropic", ""),
        "DeepSeekAPIKey": keys.get("deepseek", ""),
        "XaiAPIKey": keys.get("xai", ""),
        "GroqAPIKey": keys.get("groq", ""),
        "CohereAPIKey": keys.get("cohere", ""),
        "HuggingFaceAPIKey": keys.get("huggingface", ""),
    }
    for name, value in values.items():
        if value:
            os.environ[name] = value
        else:
            os.environ.pop(name, None)

    serialized = json.dumps(values, sort_keys=True)
    changed = serialized != _CONFIG_VERSION
    _CONFIG_VERSION = serialized
    if changed:
        # Drop only those modules so a later settings save takes effect
        for name in list(sys.modules):
            if name.startswith("Backend.") and name != __name__:
                sys.modules.pop(name, None)
    return {"configured": True, "modules_reloaded": changed}


def _import(name: str):
    return importlib.import_module(name)


def _classify(prompt: str) -> list[str]:
    module = _import("Backend.Model")
    return list(module.FirstLayerDMM(prompt))


def _chat(prompt: str) -> dict[str, Any]:
    module = _import("Backend.Chatbot")
    ans = module.ChatBot(prompt)
    if hasattr(module, "detect_identity_intent") and module.detect_identity_intent(prompt):
        engine = f"JARVIS ({getattr(module, '_identity', {}).get('model', 'ULTRON-124T')})"
    else:
        engine = getattr(module.LLM_CLIENT, "last_provider_used", "JARVIS AI")
    return {"answer": _safe_text(ans), "engine": engine}


def _realtime(prompt: str) -> dict[str, Any]:
    module = _import("Backend.RealtimeSearchEngine")
    ans = module.RealtimeSearchEngine(prompt)
    engine = getattr(module.LLM_CLIENT, "last_provider_used", "DuckDuckGo Web Search")
    return {"answer": _safe_text(ans), "engine": engine}


def _automate(commands: list[str]) -> dict[str, Any]:
    module = _import("Backend.Automation")
    result = asyncio.run(module.Automation(commands))
    if isinstance(result, dict):
        return result
    return {"ok": True, "results": result}


def _image(prompt: str, count: int = 4) -> dict[str, Any]:
    module = _import("Backend.ImageGeneration")
    files = module.GenerateImages(prompt, number_of_images=count)
    return {"prompt": prompt, "files": [str(path) for path in files]}


def _voice_embed(audio_base64: str) -> dict[str, Any]:
    global _VOICE_ENCODER
    raw = base64.b64decode(_safe_text(audio_base64), validate=True)
    if len(raw) > 2_000_000:
        raise ValueError("Voice sample exceeds the 2 MB safety limit")
    with wave.open(io.BytesIO(raw), "rb") as wav_file:
        if wav_file.getnchannels() != 1 or wav_file.getsampwidth() != 2:
            raise ValueError("Voice sample must be mono 16-bit PCM WAV")
        sample_rate = wav_file.getframerate()
        frames = wav_file.readframes(wav_file.getnframes())
    import numpy as np
    from resemblyzer import VoiceEncoder, preprocess_wav
    samples = np.frombuffer(frames, dtype=np.int16).astype(np.float32) / 32768.0
    processed = preprocess_wav(samples, source_sr=sample_rate)
    if processed.size < 16000:
        raise ValueError("Voice sample is too short; speak for at least one second")
    if _VOICE_ENCODER is None:
        _VOICE_ENCODER = VoiceEncoder("cpu")
    embedding = _VOICE_ENCODER.embed_utterance(processed)
    return {"embedding": [float(value) for value in embedding]}


def _tts(text: str, voice: str | None = None) -> dict[str, Any]:
    module = _import("Backend.TextToSpeech")
    output = ROOT / "Data" / "speech.mp3"
    asyncio.run(module.TextToAudioFile(text, output_path=output, voice=voice))
    return {"file": str(output), "voice": voice or os.environ.get("AssistantVoice", "en-CA-LiamNeural")}


def _capability(operation: str, payload: dict[str, Any]) -> Any:
    if operation == "classify":
        return {"decisions": _classify(_safe_text(payload.get("prompt")))}
    if operation == "chat":
        return _chat(_safe_text(payload.get("prompt")))
    if operation == "realtime":
        return _realtime(_safe_text(payload.get("prompt")))
    if operation == "automate":
        commands = [str(item).strip() for item in payload.get("commands", []) if str(item).strip()]
        return _automate(commands)
    if operation == "image":
        return _image(_safe_text(payload.get("prompt")), int(payload.get("count", 4)))
    if operation == "voice_embed":
        return _voice_embed(_safe_text(payload.get("audioBase64")))
    if operation == "tts":
        return _tts(_safe_text(payload.get("text")), payload.get("voice"))
    if operation == "identity":
        return _import("Backend.Identity").get_identity()
    raise ValueError(f"Unknown Python capability: {operation}")


def _response(request_id: str, ok: bool, result: Any = None, error: str | None = None) -> None:
    message: dict[str, Any] = {"id": request_id, "ok": ok}
    if ok:
        message["result"] = result
    else:
        message["error"] = error or "Python capability failed"
    print(json.dumps(message, ensure_ascii=False), flush=True)


def main() -> None:
    for raw in sys.stdin:
        request_id = "unknown"
        try:
            request = json.loads(raw)
            request_id = _safe_text(request.get("id") or "unknown")
            operation = _safe_text(request.get("op"))
            if operation == "configure":
                result = _configure(request.get("config") or {})
            else:
                # Keep third-party module console output out of the JSON-lines
                # protocol. Electron receives it through the child stderr path.
                with contextlib.redirect_stdout(sys.stderr):
                    result = _capability(operation, request.get("payload") or {})
            _response(request_id, True, result=result)
        except Exception as exc:
            traceback.print_exc(file=sys.stderr)
            _response(request_id, False, error=f"{type(exc).__name__}: {exc}")


if __name__ == "__main__":
    main()
