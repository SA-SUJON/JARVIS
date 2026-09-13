from __future__ import annotations

import asyncio
import os
import random
from pathlib import Path
from typing import Callable

import edge_tts
from dotenv import dotenv_values

try:
    import pygame
except ImportError:  # Playback is optional when Electron consumes the generated file.
    pygame = None


def _env_value(name: str, default: str = "") -> str:
    return str(os.environ.get(name) or dotenv_values(".env").get(name) or default).strip()


async def TextToAudioFile(text: str, output_path: str | Path = Path("Data") / "speech.mp3", voice: str | None = None, rate: str = "+13%", pitch: str = "+5Hz") -> str:
    clean_text = str(text).strip()
    if not clean_text:
        raise ValueError("TTS text cannot be empty")
    destination = Path(output_path)
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.exists():
        destination.unlink()
    selected_voice = voice or _env_value("AssistantVoice", "en-CA-LiamNeural")
    communicate = edge_tts.Communicate(clean_text, selected_voice, pitch=pitch, rate=rate)
    await communicate.save(str(destination))
    return str(destination)


def TTS(text: str, func: Callable[[object | None], bool] = lambda _=None: True) -> bool:
    if pygame is None:
        raise RuntimeError("pygame is not installed; use the generated audio file from TextToAudioFile")
    output = Path("Data") / "speech.mp3"
    try:
        asyncio.run(TextToAudioFile(text, output))
        pygame.mixer.init()
        pygame.mixer.music.load(str(output))
        pygame.mixer.music.play()
        while pygame.mixer.music.get_busy():
            if func() is False:
                break
            pygame.time.Clock().tick(10)
        return True
    finally:
        with_context = contextlib_suppress()
        with with_context:
            func(False)
            pygame.mixer.music.stop()
            pygame.mixer.quit()


def contextlib_suppress():
    from contextlib import suppress
    return suppress(Exception)


def TextToSpeech(text: str, func: Callable[[object | None], bool] = lambda _=None: True) -> bool:
    sentences = [part.strip() for part in str(text).split(".") if part.strip()]
    if len(sentences) > 4 and len(str(text)) > 250:
        tail = random.choice([
            "The rest of the result is available on the chat screen.",
            "The remaining detail is available on the chat screen.",
            "Please review the chat screen for the complete answer.",
        ])
        return TTS(". ".join(sentences[:2]) + ". " + tail, func)
    return TTS(str(text), func)


if __name__ == "__main__":
    while True:
        TextToSpeech(input("Enter the text: "))
