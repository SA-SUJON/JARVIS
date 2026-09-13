"""JARVIS Realtime Search Engine using DuckDuckGo and Multi-Key Gemini.

Searches the web via DuckDuckGo, synthesizes live answers with Gemini
(with multi-key rotation and multi-provider failover), preserves conversation
in Data/ChatLog.json, and delivers natural, human-tone spoken responses.
"""
from __future__ import annotations

import datetime
import html
import json
import os
import re
import urllib.parse
from pathlib import Path
from typing import Any

import requests
from dotenv import dotenv_values

from Backend.LLMManager import LLM_CLIENT

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "Data"
DATA_DIR.mkdir(parents=True, exist_ok=True)
CHAT_LOG_PATH = DATA_DIR / "ChatLog.json"

env_vars = dotenv_values(ROOT / ".env") if (ROOT / ".env").exists() else {}
Username = os.environ.get("Username") or env_vars.get("Username") or "SA SUJON"
Assistantname = os.environ.get("Assistantname") or env_vars.get("Assistantname") or "JARVIS"


def _clean_html(text: str) -> str:
    cleaned = re.sub(r"<[^>]+>", " ", text)
    cleaned = html.unescape(cleaned)
    return " ".join(cleaned.split())


def DuckDuckGoSearch(query: str, max_results: int = 5) -> str:
    """Perform a live web search using DuckDuckGo with live weather, news, and knowledge fallbacks."""
    clean_query = query.strip()
    if not clean_query:
        return "No search query provided."

    hits: list[dict[str, str]] = []
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    }

    # 1. Specialized Live Weather via Open-Meteo
    if re.search(r"\b(weather|temperature|forecast|rain|climate)\b", clean_query, re.I):
        city_match = re.search(r"(?:in|for|at|of)\s+([A-Za-z\s]+?)(?:\s+today|\s+now|\s+tomorrow|\?|\.|$)", clean_query, re.I)
        city = city_match.group(1).strip() if city_match else ""
        if not city:
            # Fallback check for single or trailing word as city
            words = [w for w in clean_query.split() if w.lower() not in ["what", "is", "the", "weather", "temperature", "in", "for", "at", "today", "now", "like", "how"]]
            if words:
                city = " ".join(words)
        if city:
            try:
                geo_url = f"https://geocoding-api.open-meteo.com/v1/search?name={urllib.parse.quote_plus(city)}&count=1"
                geo_res = requests.get(geo_url, timeout=5)
                if geo_res.ok and geo_res.json().get("results"):
                    loc = geo_res.json()["results"][0]
                    lat, lon = loc["latitude"], loc["longitude"]
                    country = loc.get("country", "")
                    w_url = f"https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}&current_weather=true"
                    w_res = requests.get(w_url, timeout=5)
                    if w_res.ok:
                        cw = w_res.json().get("current_weather", {})
                        temp_c = cw.get("temperature")
                        wind = cw.get("windspeed")
                        code = cw.get("weathercode", 0)
                        weather_desc = {
                            0: "Clear sky", 1: "Mainly clear", 2: "Partly cloudy", 3: "Overcast",
                            45: "Fog", 48: "Depositing rime fog", 51: "Light drizzle", 53: "Moderate drizzle",
                            61: "Slight rain", 63: "Moderate rain", 65: "Heavy rain", 71: "Slight snow",
                            80: "Rain showers", 95: "Thunderstorm",
                        }.get(code, "Clear/Fair")
                        hits.append({
                            "title": f"Live Weather in {loc.get('name', city)}, {country}",
                            "snippet": f"Temperature: {temp_c}°C ({temp_c * 9/5 + 32:.1f}°F), Conditions: {weather_desc}, Wind Speed: {wind} km/h.",
                            "url": f"https://open-meteo.com/en/docs#latitude={lat}&longitude={lon}",
                        })
            except Exception:
                pass

    # 2. Specialized Live News via Google News RSS
    if re.search(r"\b(news|headline|headlines|breaking|update|score|match|game|election|stock|price|market|today|recent|latest)\b", clean_query, re.I):
        try:
            import xml.etree.ElementTree as ET
            rss_url = f"https://news.google.com/rss/search?q={urllib.parse.quote_plus(clean_query)}&hl=en-US&gl=US&ceid=US:en"
            rss_res = requests.get(rss_url, headers=headers, timeout=6)
            if rss_res.ok:
                root = ET.fromstring(rss_res.text)
                for item in root.findall(".//item")[:max_results]:
                    title_elem = item.find("title")
                    link_elem = item.find("link")
                    pub_elem = item.find("pubDate")
                    if title_elem is not None and title_elem.text:
                        hits.append({
                            "title": title_elem.text.strip(),
                            "snippet": f"Reported {pub_elem.text.strip() if pub_elem is not None and pub_elem.text else 'recently'}.",
                            "url": link_elem.text.strip() if link_elem is not None and link_elem.text else "https://news.google.com",
                        })
        except Exception:
            pass

    # 3. DuckDuckGo Instant Answer API
    try:
        api_url = f"https://api.duckduckgo.com/?q={urllib.parse.quote_plus(clean_query)}&format=json&no_html=1&skip_disambig=0"
        res = requests.get(api_url, headers=headers, timeout=6)
        if res.ok:
            data = res.json()
            abstract = data.get("AbstractText", "")
            if abstract:
                hits.append({
                    "title": data.get("Heading", clean_query),
                    "snippet": abstract,
                    "url": data.get("AbstractURL", "https://duckduckgo.com"),
                })
            # Check related topics
            for topic in data.get("RelatedTopics", [])[:3]:
                if isinstance(topic, dict) and topic.get("Text") and topic.get("FirstURL"):
                    hits.append({
                        "title": topic.get("Text", "")[:60],
                        "snippet": topic.get("Text", ""),
                        "url": topic.get("FirstURL", ""),
                    })
    except Exception:
        pass

    # 4. Wikipedia Live Knowledge API (for encyclopedic / entity queries)
    if len(hits) < 2:
        try:
            wiki_url = f"https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch={urllib.parse.quote_plus(clean_query)}&format=json&utf8=1"
            wiki_res = requests.get(wiki_url, headers={"User-Agent": "JarvisAI/1.0"}, timeout=6)
            if wiki_res.ok:
                wiki_results = wiki_res.json().get("query", {}).get("search", [])
                for item in wiki_results[:3]:
                    w_title = item.get("title", "")
                    w_snippet = _clean_html(item.get("snippet", ""))
                    if w_title and w_snippet:
                        hits.append({
                            "title": f"{w_title} (Wikipedia)",
                            "snippet": w_snippet,
                            "url": f"https://en.wikipedia.org/wiki/{urllib.parse.quote(w_title)}",
                        })
        except Exception:
            pass

    # Deduplicate hits by URL or Title
    unique_hits: list[dict[str, str]] = []
    seen_keys: set[str] = set()
    for h in hits:
        key = h.get("url") or h.get("title") or ""
        if key and key not in seen_keys:
            seen_keys.add(key)
            unique_hits.append(h)
        if len(unique_hits) >= max_results:
            break

    if not unique_hits:
        return f"No live search results found on DuckDuckGo for: {clean_query}"

    formatted = [f"Live Web Search Results for '{clean_query}':"]
    for i, h in enumerate(unique_hits, 1):
        formatted.append(f"{i}. {h['title']}\nSummary: {h['snippet']}\nSource: {h['url']}")

    return "\n\n".join(formatted)


def GetTemporalContext() -> str:
    now = datetime.datetime.now()
    return (
        f"Temporal Information:\n"
        f"Current Day: {now.strftime('%A')}\n"
        f"Date: {now.strftime('%d %B %Y')}\n"
        f"Time: {now.strftime('%I:%M %p')}\n"
    )


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
    # Remove markdown bold/italic tags and formatting characters
    cleaned = re.sub(r"\*{1,3}", "", cleaned)
    cleaned = re.sub(r"^#{1,6}\s*", "", cleaned, flags=re.MULTILINE)
    cleaned = re.sub(r"`{1,3}[^`]*`{1,3}", "", cleaned)
    lines = [line.strip() for line in cleaned.splitlines() if line.strip()]
    return " ".join(lines)


def RealtimeSearchEngine(prompt: str) -> str:
    """Query DuckDuckGo and synthesize a natural human answer with Gemini/fallback."""
    clean_prompt = prompt.strip()
    if not clean_prompt:
        return "I didn't catch what you wanted to search for, Sir."

    # 1. Retrieve DuckDuckGo search hits
    search_context = DuckDuckGoSearch(clean_prompt)
    temporal_context = GetTemporalContext()

    # 2. Construct system instruction emphasizing human-like, conversational tone
    system_instruction = (
        f"You are {Assistantname}, an exceptionally intelligent, warm, and natural personal AI assistant. "
        f"You are speaking directly to {Username}. "
        f"Answer like a thoughtful, articulate human colleague with a calm, conversational tone. "
        f"Do not sound like a robotic search readout or list raw URLs unless asked. "
        f"Speak in flowing natural paragraphs with smooth transitions (e.g. 'According to recent reports...', 'It appears that...'). "
        f"Synthesize the provided DuckDuckGo web results seamlessly into your answer.\n\n"
        f"{temporal_context}\n"
        f"{search_context}"
    )

    # 3. Load chat history
    history = LoadChatLog()
    chat_history_for_llm = [
        {"role": item.get("role", "user"), "content": item.get("content", "")}
        for item in history[-6:]
    ]

    # 4. Generate answer using LLMManager (Gemini primary with key rotation and failover)
    raw_answer, provider_used = LLM_CLIENT.generate(
        prompt=clean_prompt,
        system_instruction=system_instruction,
        preferred_provider="gemini",
        chat_history=chat_history_for_llm,
    )

    human_answer = CleanSpokenAnswer(raw_answer)

    # 5. Append to ChatLog.json with attribution to JARVIS and the active AI engine
    now_iso = datetime.datetime.now().isoformat()
    history.append({
        "role": "user",
        "sender": Username,
        "content": clean_prompt,
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
            q = input("Search Query >>> ")
            if not q.strip():
                break
            print("\nJARVIS:", RealtimeSearchEngine(q), "\n")
        except (KeyboardInterrupt, EOFError):
            break