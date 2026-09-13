from __future__ import annotations

import os
import re
import webbrowser
from pathlib import Path
from random import randint
from typing import Iterable

import requests
from dotenv import dotenv_values

API_URL = "https://api-inference.huggingface.co/models/stabilityai/stable-diffusion-xl-base-1.0"


def _env_value(name: str) -> str:
    return str(os.environ.get(name) or dotenv_values(".env").get(name) or "").strip()


def _safe_stem(prompt: str) -> str:
    value = re.sub(r"[^a-zA-Z0-9._-]+", "_", prompt.strip()).strip("._")
    return (value or "jarvis_image")[:80]


def query(payload: dict, timeout: int = 120) -> bytes:
    token = _env_value("HuggingFaceAPIKey")
    if not token:
        raise RuntimeError("HuggingFaceAPIKey is not configured")
    response = requests.post(API_URL, headers={"Authorization": f"Bearer {token}"}, json=payload, timeout=timeout)
    content_type = response.headers.get("content-type", "")
    if not response.ok:
        detail = response.text[:500].replace("\n", " ")
        raise RuntimeError(f"Hugging Face image generation failed ({response.status_code}): {detail}")
    if "json" in content_type.lower():
        try:
            detail = response.json()
        except ValueError:
            detail = response.text[:500]
        raise RuntimeError(f"Hugging Face image generation returned an error: {detail}")
    if not response.content:
        raise RuntimeError("Hugging Face returned an empty image")
    return response.content


def generate_images(prompt: str, output_dir: str | Path = "Data", count: int = 4) -> list[str]:
    clean_prompt = prompt.strip()
    if not clean_prompt:
        raise ValueError("Image prompt cannot be empty")
    destination = Path(output_dir)
    destination.mkdir(parents=True, exist_ok=True)
    amount = max(1, min(int(count), 4))
    files: list[str] = []
    for index in range(1, amount + 1):
        payload = {"inputs": f"{clean_prompt}, high quality, sharp focus, detailed, high resolution, seed={randint(0, 1_000_000)}"}
        image_bytes = query(payload)
        target = destination / f"{_safe_stem(clean_prompt)}{index}.jpg"
        target.write_bytes(image_bytes)
        files.append(str(target))
    return files


def open_images(files: Iterable[str | Path]) -> None:
    for item in files:
        target = Path(item)
        if target.exists():
            webbrowser.open(target.resolve().as_uri())


def GenerateImages(prompt: str) -> list[str]:
    files = generate_images(prompt)
    open_images(files)
    return files


def main() -> None:
    trigger = Path("Frontend") / "Files" / "ImageGeneration.data"
    while True:
        try:
            if trigger.exists():
                raw = trigger.read_text(encoding="utf-8").strip()
                if raw:
                    prompt, status = raw.rsplit(",", 1)
                    if status.strip().lower() == "true":
                        GenerateImages(prompt)
                        trigger.write_text("False,False", encoding="utf-8")
                        return
        except Exception as exc:
            print(f"ImageGeneration error: {exc}", flush=True)
        import time
        time.sleep(1)


if __name__ == "__main__":
    main()
