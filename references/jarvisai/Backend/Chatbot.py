"""JARVIS Conversational Chatbot Engine.

Provides conversational AI with primary Google Gemini (multi-key pool),
seamless multi-provider fallback (OpenAI, Claude, DeepSeek, Grok, Groq, Cohere),
natural human tone, and conversation tracking in Data/ChatLog.json.
"""
from __future__ import annotations

import datetime
import json
import os
import re
from pathlib import Path
from typing import Any
from dotenv import dotenv_values

from Backend.LLMManager import LLM_CLIENT
from Backend.Identity import (
    get_identity,
    get_hardened_system_prompt,
    detect_identity_intent,
    get_hardened_identity_answer,
    sanitize_response,
)

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "Data"
DATA_DIR.mkdir(parents=True, exist_ok=True)
CHAT_LOG_PATH = DATA_DIR / "ChatLog.json"

_identity = get_identity()
env_vars = dotenv_values(ROOT / ".env") if (ROOT / ".env").exists() else {}
Username = os.environ.get("Username") or env_vars.get("Username") or _identity["creator"]
Assistantname = os.environ.get("Assistantname") or env_vars.get("Assistantname") or _identity["ai_name"]


def LoadChatLog() -> list[dict[str, Any]]:
    if CHAT_LOG_PATH.exists():
        try:
            with open(CHAT_LOG_PATH, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return []
    return []


def SaveChatLog(messages: list[dict[str, Any]]) -> None:
    try:
        with open(CHAT_LOG_PATH, "w", encoding="utf-8") as f:
            json.dump(messages, f, indent=2, ensure_ascii=False)
    except Exception:
        pass


def CleanSpokenAnswer(text: str) -> str:
    cleaned = text.strip()
    # Remove markdown asterisks, hashes, and unwanted code blocks
    cleaned = re.sub(r"\*{1,3}", "", cleaned)
    cleaned = re.sub(r"^#{1,6}\s*", "", cleaned, flags=re.MULTILINE)
    cleaned = cleaned.replace("</s>", "")
    lines = [line.strip() for line in cleaned.splitlines() if line.strip()]
    return "\n".join(lines)


def ChatBot(query: str) -> str:
    """Handle user query using primary Gemini multi-key with multi-AI fallback."""
    clean_query = query.strip()
    if not clean_query:
        return f"I am listening, {Username}. How may I help you today?"

    # 1. Cryptographically verified Identity Intercept
    identity_intent = detect_identity_intent(clean_query)
    if identity_intent:
        direct_answer = get_hardened_identity_answer(identity_intent)
        now_iso = datetime.datetime.now().isoformat()
        history = LoadChatLog()
        history.append({
            "role": "user",
            "sender": Username,
            "content": clean_query,
            "timestamp": now_iso,
        })
        history.append({
            "role": "assistant",
            "agent": Assistantname,
            "engine": f"JARVIS ({_identity['model']})",
            "content": direct_answer,
            "timestamp": now_iso,
        })
        SaveChatLog(history)
        return direct_answer

    system_instruction = (
        f"{get_hardened_system_prompt()}\n\n"
        f"You are {Assistantname}, a warm, articulate, highly capable AI assistant talking to {Username}. "
        f"Speak like a thoughtful, natural human colleague with an attentive, pleasant, and lightly confident presence. "
        f"Answer directly first, then add only the most helpful context. "
        f"Do not sound like a robotic script or recite dry lists unless explicitly requested. "
        f"Use natural conversational rhythm and contractions (e.g. 'I've checked', 'Here's what we have'). "
        f"Keep responses easy to listen to when spoken aloud by text-to-speech."
    )

    # 2. Load history
    history = LoadChatLog()
    chat_history_for_llm = [
        {"role": item.get("role", "user"), "content": item.get("content", "")}
        for item in history[-8:]
    ]

    # 3. Call LLMManager (Primary Gemini with multi-key rotation and multi-agent failover)
    raw_answer, provider_used = LLM_CLIENT.generate(
        prompt=clean_query,
        system_instruction=system_instruction,
        preferred_provider="gemini",
        chat_history=chat_history_for_llm,
    )

    human_answer = sanitize_response(CleanSpokenAnswer(raw_answer))

    # 4. Record interaction in ChatLog.json with attribution to JARVIS and the active engine
    now_iso = datetime.datetime.now().isoformat()
    history.append({
        "role": "user",
        "sender": Username,
        "content": clean_query,
        "timestamp": now_iso,
    })
    history.append({
        "role": "assistant",
        "agent": Assistantname,
        "engine": provider_used,
        "content": human_answer,
        "timestamp": now_iso,
    })
    SaveChatLog(history)

    return human_answer


if __name__ == "__main__":
    while True:
        try:
            user_input = input("You >>> ")
            if not user_input.strip():
                break
            print("\nJARVIS:", ChatBot(user_input), "\n")
        except (KeyboardInterrupt, EOFError):
            break
