"""Decision-Making Model (Query Selector) for JARVIS.

Categorizes queries into:
- 'general (query)': standard conversational chatbot query (routed to Chatbot.py)
- 'realtime (query)': live web/news/current information query (routed to RealtimeSearchEngine.py)
- 'open (app/website)': app/web launch automation (routed to Automation.py)
- 'close (app)': close application (routed to Automation.py)
- 'play (song/media)': play media (routed to Automation.py)
- 'generate image (prompt)': image generation (routed to ImageGeneration.py)
- 'system (task)': system control like volume, wifi, bluetooth, lock (routed to Automation.py)
- 'content (topic)': document/text content generation (routed to Automation.py)
- 'google search / youtube search': search queries
- 'exit': terminate/standby

Primary query classification uses fast deterministic heuristic rules for instant
classification (no API call needed). Falls back to Cohere v2 API or
Gemini (multi-key) / OpenAI / Claude if the query is ambiguous.
"""
from __future__ import annotations

import os
import re
from pathlib import Path
from typing import Any

import requests
from dotenv import dotenv_values

from Backend.LLMManager import LLM_CLIENT
from Backend.Identity import detect_identity_intent

ROOT = Path(__file__).resolve().parent.parent
env_vars = dotenv_values(ROOT / ".env") if (ROOT / ".env").exists() else {}

FUNCS = [
    "exit", "general", "realtime", "open", "close", "play",
    "generate image", "system", "content", "google search",
    "youtube search", "reminder",
]

PREAMBLE = """
You are a very accurate Decision-Making Model, which decides what kind of query is given to you.
You will decide whether a query is a 'general' query, a 'realtime' query, or is asking to perform an automation or task like 'open chrome', 'close notepad', 'play despacito', 'generate image of an eagle', 'turn off wifi', 'volume up'.
*** Do not answer the query. Just output the classification tag(s) separated by commas. ***
-> Respond with 'general (query)' if the query can be answered conversationally by an LLM without live web search. E.g. 'general how can I learn Python', 'general tell me a joke', 'general write a poem', 'general what is gravity'.
-> Respond with 'realtime (query)' if the query needs current up-to-date information from the internet, current news, live weather, stock prices, scores, or recent events. E.g. 'realtime what is today's headline', 'realtime who won the match today', 'realtime weather in Tokyo'.
-> Respond with 'open (application or website)' if asking to open anything. E.g. 'open notepad', 'open spotify', 'open youtube'.
-> Respond with 'close (application)' if asking to close anything. E.g. 'close chrome', 'close notepad'.
-> Respond with 'play (song or video)' if asking to play music/video. E.g. 'play bohemian rhapsody', 'play lofi beats'.
-> Respond with 'generate image (prompt)' if asking to create/draw/generate an image or picture. E.g. 'generate image a futuristic cyberpunk city'.
-> Respond with 'system (action)' for system toggles: mute, unmute, volume up, volume down, lock, sleep, wifi, bluetooth, settings.
-> Respond with 'content (topic)' if asking to draft an essay, letter, email, or file to save.
-> If multiple tasks: separate with commas, e.g. 'open chrome, play starboy'.
-> Respond with 'exit' if the user says goodbye or wants to exit.
"""


def _fast_deterministic_rules(query: str) -> list[str]:
    """Instant heuristic classification for unambiguous commands.

    This runs at ~0ms and handles the vast majority of common commands
    without any API call. Falls through to LLM classification only
    for truly ambiguous or complex queries.
    """
    clean = query.strip()
    lower = clean.lower()
    results: list[str] = []

    # --- Identity inquiries (route immediately to general chatbot with hardened identity guard) ---
    if detect_identity_intent(clean):
        return [f"general {clean}"]

    # --- Exit / Goodbye ---
    exit_patterns = [
        r"^(goodbye|bye|exit|quit|stop|shut\s*down|see\s+you|good\s*night|sleep\s+mode|deactivate|standby)$",
        r"^(ok\s+)?bye\b",
        r"^(that'?s?\s+all|i'?m?\s+done|no\s+more)$",
    ]
    for pat in exit_patterns:
        if re.match(pat, lower):
            return ["exit"]

    # --- Image generation ---
    img_match = re.match(
        r"^(?:generate|create|make|draw|design|render|paint)\s+(?:an?\s+)?(?:image|picture|photo|illustration|artwork|icon)\s+(?:of\s+|about\s+)?(.+)$",
        lower,
        re.I,
    )
    if img_match:
        return [f"generate image {img_match.group(1).strip()}"]

    # --- Media playback ---
    play_match = re.match(r"^play\s+(.+)$", lower, re.I)
    if play_match:
        return [f"play {play_match.group(1).strip()}"]

    # --- Open / Close ---
    if lower.startswith("open "):
        results.append(f"open {clean[5:].strip()}")
    if lower.startswith("close "):
        results.append(f"close {clean[6:].strip()}")
    if lower.startswith("launch "):
        results.append(f"open {clean[7:].strip()}")
    if lower.startswith("start "):
        target = clean[6:].strip().lower()
        # "start recording" is not an app open, but "start chrome" is
        if target not in ["recording", "listening", "speaking", "timer"]:
            results.append(f"open {clean[6:].strip()}")

    # --- System controls (comprehensive) ---
    system_commands = {
        "mute": "system mute",
        "unmute": "system unmute",
        "volume up": "system volume up",
        "volume down": "system volume down",
        "lock": "system lock",
        "lock screen": "system lock",
        "lock workstation": "system lock",
        "lock computer": "system lock",
        "lock pc": "system lock",
        "sleep": "system sleep",
        "sleep mode": "system sleep",
        "hibernate": "system sleep",
        "open settings": "system open settings",
        "open task manager": "system open task manager",
        "open wifi settings": "system open wifi settings",
        "open bluetooth settings": "system open bluetooth settings",
        "open display settings": "system open display settings",
        "open sound settings": "system open sound settings",
        "open battery settings": "system open battery settings",
        "open airplane settings": "system open airplane settings",
    }
    if lower in system_commands:
        return [system_commands[lower]]

    # Toggle commands: "turn on wifi", "turn off bluetooth", "enable wifi", "disable bluetooth"
    toggle_match = re.match(
        r"^(?:turn\s+(?:on|off)|toggle|enable|disable|switch\s+(?:on|off)|activate|deactivate)\s+"
        r"(wifi|wi-fi|bluetooth|bt|airplane\s*mode|hotspot|mobile\s*hotspot|night\s*light|dark\s*mode|do\s*not\s*disturb|location|gps)$",
        lower,
    )
    if toggle_match:
        target = toggle_match.group(1).strip()
        mapping = {
            "wifi": "open wifi settings",
            "wi-fi": "open wifi settings",
            "bluetooth": "open bluetooth settings",
            "bt": "open bluetooth settings",
            "airplane mode": "open airplane settings",
            "airplanemode": "open airplane settings",
            "hotspot": "open wifi settings",
            "mobile hotspot": "open wifi settings",
            "mobilehotspot": "open wifi settings",
            "night light": "open display settings",
            "nightlight": "open display settings",
            "dark mode": "open display settings",
            "darkmode": "open display settings",
            "do not disturb": "open sound settings",
            "donotdisturb": "open sound settings",
            "location": "open settings",
            "gps": "open settings",
        }
        return [f"system {mapping.get(target, 'open settings')}"]

    # Volume control with numbers: "set volume to 50", "volume 80"
    vol_match = re.match(r"^(?:set\s+)?volume\s+(?:to\s+)?(\d+)$", lower)
    if vol_match:
        return [f"system volume {vol_match.group(1)}"]

    # Brightness: "brightness up", "brightness down", "set brightness to 50"
    if re.match(r"^(?:brightness|screen\s+brightness)\s+(up|down|max|min|\d+)", lower):
        return [f"system {lower}"]

    # --- File operations ---
    file_create = re.match(
        r"^(?:create|make|write)\s+(?:a\s+)?(?:new\s+)?file\s+(?:named?\s+|called?\s+)?([^\s]+)(?:\s+with\s+(?:content|text)\s+(.+))?$",
        lower,
        re.I,
    )
    if file_create:
        return [f"content create file {file_create.group(1)} {file_create.group(2) or ''}".strip()]

    file_delete = re.match(
        r"^(?:delete|remove|trash)\s+(?:the\s+)?file\s+(?:named?\s+|called?\s+)?(.+)$",
        lower,
        re.I,
    )
    if file_delete:
        return [f"system delete file {file_delete.group(1).strip()}"]

    # --- Content generation ---
    content_match = re.match(
        r"^(?:write|draft|compose|generate)\s+(?:an?\s+|the\s+)?"
        r"(essay|letter|email|report|article|story|poem|script|blog\s*post|code|document|note|memo|summary|review)\s+"
        r"(?:about\s+|on\s+|for\s+|regarding\s+)?(.+)$",
        lower,
        re.I,
    )
    if content_match:
        return [f"content {content_match.group(1)} about {content_match.group(2).strip()}"]

    # --- Search patterns ---
    google_search = re.match(r"^(?:google|search\s+(?:on\s+)?google(?:\s+for)?)\s+(.+)$", lower, re.I)
    if google_search:
        return [f"google search {google_search.group(1).strip()}"]

    youtube_search = re.match(r"^(?:youtube\s+search|search\s+(?:on\s+)?youtube(?:\s+for)?)\s+(.+)$", lower, re.I)
    if youtube_search:
        return [f"youtube search {youtube_search.group(1).strip()}"]

    # "search for X" (general web search → realtime)
    web_search = re.match(r"^(?:search|look\s+up|find\s+(?:out\s+)?(?:about\s+)?)\s+(.+)$", lower, re.I)
    if web_search:
        return [f"realtime {web_search.group(1).strip()}"]

    # --- Realtime triggers ---
    realtime_patterns = [
        r"\b(today'?s?|current|latest|breaking|recent|live)\s+(news|headline|weather|score|price|update|result|trending)",
        r"\bweather\s+(in|at|for|of)\b",
        r"\btemperature\s+(in|at|for|of)\b",
        r"\bwho\s+is\s+(the\s+)?(current|present|new|acting)\b",
        r"\b(stock\s+price|crypto\s+price|bitcoin\s+price|market\s+price)\b",
        r"\b(what\s+time|current\s+time|time\s+in|time\s+at)\b",
        r"\b(what'?s?\s+the\s+date|today'?s?\s+date|current\s+date)\b",
        r"\b(latest|current|today|live|recent|breaking)\b.*(news|score|update|event|match|game)\b",
        r"\b(who\s+won|score\s+of|result\s+of)\b",
        r"\b(trending|viral|popular)\s+(on|in|right\s+now)\b",
        r"\b(exchange\s+rate|dollar\s+to|usd\s+to|convert\s+currency)\b",
    ]
    for pattern in realtime_patterns:
        if re.search(pattern, lower):
            return [f"realtime {clean}"]

    # If we already have results from open/close patterns, return them
    if results:
        return results

    # Multi-command detection: "open X and Y", "open X and play Y"
    # e.g. "open chrome and play music" → ["open chrome", "play music"]
    multi_match = re.match(
        r"^(open|close|play|launch|start)\s+(.+?)\s+and\s+(open|close|play|launch|start)\s+(.+)$",
        lower,
        re.I,
    )
    if multi_match:
        cmd1 = f"{'open' if multi_match.group(1) in ['launch', 'start'] else multi_match.group(1)} {multi_match.group(2).strip()}"
        cmd2 = f"{'open' if multi_match.group(3) in ['launch', 'start'] else multi_match.group(3)} {multi_match.group(4).strip()}"
        return [cmd1, cmd2]

    # "open X and tell me about Y" → open + general
    multi_match2 = re.match(
        r"^(open|launch|start)\s+(.+?)\s+and\s+(.+)$", lower, re.I
    )
    if multi_match2:
        return [
            f"open {multi_match2.group(2).strip()}",
            f"general {multi_match2.group(3).strip()}",
        ]

    return []


def _clean_and_filter_decisions(raw_output: str) -> list[str]:
    cleaned = raw_output.replace("\n", ",").replace("(", " ").replace(")", " ")
    parts = [p.strip() for p in cleaned.split(",") if p.strip()]
    results: list[str] = []
    for item in parts:
        normalized = " ".join(item.split())
        for func in FUNCS:
            if normalized.lower().startswith(func):
                results.append(normalized)
                break
    return results


def _cohere_classify(prompt: str, api_key: str) -> list[str]:
    """Use Cohere v2 chat API (via requests) for query classification.

    Uses the REST API directly instead of the Cohere SDK to avoid
    SDK version compatibility issues.
    """
    try:
        res = requests.post(
            "https://api.cohere.com/v2/chat",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": "command-a-03-2025",
                "messages": [
                    {"role": "system", "content": PREAMBLE.strip()},
                    {"role": "user", "content": prompt},
                ],
                "temperature": 0.3,
            },
            timeout=20,
        )
        if res.ok:
            data = res.json()
            parts = data.get("message", {}).get("content", [])
            text = "".join(p.get("text", "") for p in parts if p.get("text")).strip()
            decisions = _clean_and_filter_decisions(text)
            if decisions:
                return decisions
    except Exception:
        pass
    return []


def FirstLayerDMM(prompt: str = "test") -> list[str]:
    """Classify the user prompt into one or more execution tasks.

    Pipeline:
    1. Fast deterministic heuristic rules (instant, ~0ms)
    2. Cohere v2 API (always-on query selector, no SDK dependency)
    3. Gemini/OpenAI/Claude via LLMManager (fallback classifier)
    4. Safe default: general
    """
    clean_prompt = prompt.strip()
    if not clean_prompt:
        return ["general hello"]

    # Step 1: Fast deterministic rule check (instant)
    deterministic = _fast_deterministic_rules(clean_prompt)
    if deterministic:
        return deterministic

    # Step 2: Attempt Cohere v2 API (as the always-on query selector)
    cohere_key = os.environ.get("CohereAPIKey") or env_vars.get("CohereAPIKey", "")
    if cohere_key and cohere_key.strip():
        decisions = _cohere_classify(clean_prompt, cohere_key.strip())
        if decisions:
            return decisions

    # Step 3: Fallback to LLMManager (Gemini multi-key / OpenAI / Claude)
    try:
        raw_answer, _ = LLM_CLIENT.generate(
            prompt=(
                f"Categorize this user query: '{clean_prompt}'. "
                f"Answer with only the task tags, e.g. 'general {clean_prompt}' or 'realtime {clean_prompt}'."
            ),
            system_instruction=PREAMBLE,
            preferred_provider="gemini",
        )
        decisions = _clean_and_filter_decisions(raw_answer)
        if decisions:
            return decisions
    except Exception:
        pass

    # Step 4: Final safe default
    return [f"general {clean_prompt}"]


if __name__ == "__main__":
    while True:
        try:
            inp = input("Query >>> ")
            if not inp.strip():
                break
            print("Decision:", FirstLayerDMM(inp))
        except (KeyboardInterrupt, EOFError):
            break