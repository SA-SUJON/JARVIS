"""JARVIS Main Orchestration Engine.

Supervises speech recognition, decision routing (Model.py), real-time search,
local automation, image generation, and speech synthesis without requiring
the legacy PyQt Frontend folder.
"""
from __future__ import annotations

import asyncio
import json
import os
import sys
import threading
from pathlib import Path
from time import sleep

from dotenv import dotenv_values

from Backend.Automation import Automation
from Backend.Chatbot import ChatBot
from Backend.ImageGeneration import GenerateImages
from Backend.Model import FirstLayerDMM
from Backend.RealtimeSearchEngine import RealtimeSearchEngine
from Backend.SpeechToText import QueryModifier, SpeechRecognition
from Backend.TextToSpeech import TextToSpeech

ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "Data"
DATA_DIR.mkdir(parents=True, exist_ok=True)
TEMP_DIR = ROOT / "Frontend" / "Files"
TEMP_DIR.mkdir(parents=True, exist_ok=True)

env_vars = dotenv_values(ROOT / ".env") if (ROOT / ".env").exists() else {}
Username = os.environ.get("Username") or env_vars.get("Username") or "SA SUJON"
Assistantname = os.environ.get("Assistantname") or env_vars.get("Assistantname") or "JARVIS"

FUNCTIONS = ["open", "close", "play", "system", "content", "google search", "youtube search"]


def SetAssistantStatus(status: str) -> None:
    try:
        (TEMP_DIR / "Status.data").write_text(status, encoding="utf-8")
    except Exception:
        pass


def ShowTextToScreen(text: str) -> None:
    if text:
        print(f"[{Assistantname}] {text}", flush=True)


def ProcessQuery(query: str) -> str:
    """Core pipeline: takes query string, routes intent, executes, and returns answer."""
    clean_query = query.strip()
    if not clean_query:
        return ""

    SetAssistantStatus("Thinking...")
    decisions = FirstLayerDMM(clean_query)
    print(f"\n[JARVIS Decider] Tasks: {decisions}", flush=True)

    # 1. Check for image generation
    image_task = next((d for d in decisions if d.startswith("generate image")), None)
    if image_task:
        prompt = image_task[len("generate image"):].strip()
        SetAssistantStatus("Generating image...")
        files = GenerateImages(prompt)
        answer = f"Generated {len(files)} image(s) for '{prompt}'."
        TextToSpeech(answer)
        return answer

    # 2. Check for automation actions
    auto_tasks = [d for d in decisions if any(d.startswith(f) for f in FUNCTIONS)]
    if auto_tasks:
        SetAssistantStatus("Automating...")
        result = asyncio.run(Automation(auto_tasks))
        results = result.get("results", [])
        summary = "; ".join(f"{item.get('action')}: {item.get('detail')}" for item in results if item.get("ok"))
        if not summary:
            summary = f"Executed {len(auto_tasks)} automation action(s)."
        TextToSpeech(summary)
        return summary

    # 3. Check for Realtime Search
    is_realtime = any(d.startswith("realtime") for d in decisions)
    if is_realtime:
        SetAssistantStatus("Searching DuckDuckGo...")
        realtime_query = next((d[len("realtime"):].strip() for d in decisions if d.startswith("realtime")), clean_query)
        answer = RealtimeSearchEngine(QueryModifier(realtime_query))
        SetAssistantStatus("Answering...")
        TextToSpeech(answer)
        return answer

    # 4. Check for General Chatbot
    general_query = next((d[len("general"):].strip() for d in decisions if d.startswith("general")), clean_query)
    SetAssistantStatus("Synthesizing...")
    answer = ChatBot(QueryModifier(general_query))
    SetAssistantStatus("Answering...")
    TextToSpeech(answer)
    return answer


def ConsoleLoop() -> None:
    """Interactive command-line listener when run directly."""
    print(f"==================================================")
    print(f"  {Assistantname} AI Core Online // Operator: {Username}")
    print(f"  Type a command, or press Enter on blank prompt to listen to mic")
    print(f"==================================================\n")

    while True:
        try:
            user_input = input(f"{Username} >>> ").strip()
            if not user_input:
                print("[MIC] Listening...", flush=True)
                user_input = SpeechRecognition()
                if user_input:
                    print(f"{Username} (Voice) >>> {user_input}", flush=True)
                else:
                    continue

            if user_input.lower() in ["exit", "quit", "bye", "shutdown"]:
                farewell = "Powering down neural links. Goodbye, Sir."
                print(f"[{Assistantname}] {farewell}")
                TextToSpeech(farewell)
                break

            response = ProcessQuery(user_input)
            ShowTextToScreen(response)
            print()
        except (KeyboardInterrupt, EOFError):
            print("\nShutting down...")
            break
        except Exception as exc:
            print(f"[Error] {exc}", file=sys.stderr)


if __name__ == "__main__":
    ConsoleLoop()