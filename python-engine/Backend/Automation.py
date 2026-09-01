"""Safe, ultra-reliable, Electron-callable automation for JARVIS.

Direct Windows ShellExecute & process automation without slow or buggy third-party wrappers.
"""
from __future__ import annotations

import asyncio
import os
import re
import shutil
import subprocess
import webbrowser
from pathlib import Path
from typing import Any
from urllib.parse import quote_plus

try:
    from dotenv import dotenv_values
except Exception:
    dotenv_values = lambda *_args, **_kwargs: {}

try:
    import keyboard
except Exception:
    keyboard = None

try:
    from groq import Groq
except Exception:
    Groq = None

ROOT = Path.cwd()
DATA_DIR = ROOT / "Data"
DATA_DIR.mkdir(parents=True, exist_ok=True)
ENV = dotenv_values(ROOT / ".env") if (ROOT / ".env").exists() else {}
ASSISTANT_NAME = os.environ.get("Assistantname") or ENV.get("Assistantname") or "JARVIS"
USERNAME = os.environ.get("Username") or ENV.get("Username") or "SA SUJON"
GROQ_KEY = os.environ.get("GroqAPIKey") or ENV.get("GroqAPIKey") or ""

URL_ALIASES = {
    "youtube": "https://www.youtube.com/",
    "youtube music": "https://music.youtube.com/",
    "google": "https://www.google.com/",
    "gmail": "https://mail.google.com/",
    "google drive": "https://drive.google.com/",
    "google maps": "https://maps.google.com/",
    "chatgpt": "https://chatgpt.com/",
    "claude": "https://claude.ai/",
    "gemini": "https://gemini.google.com/",
    "discord": "https://discord.com/app",
    "whatsapp": "https://web.whatsapp.com/",
    "facebook": "https://www.facebook.com/",
    "instagram": "https://www.instagram.com/",
    "github": "https://github.com/",
    "spotify": "https://open.spotify.com/",
    "netflix": "https://www.netflix.com/",
    "reddit": "https://reddit.com/",
}

# Windows executable and URI scheme mapping
APP_MAP = {
    "notepad": "notepad.exe",
    "calculator": "calc.exe",
    "calc": "calc.exe",
    "paint": "mspaint.exe",
    "mspaint": "mspaint.exe",
    "file explorer": "explorer.exe",
    "explorer": "explorer.exe",
    "task manager": "taskmgr.exe",
    "taskmgr": "taskmgr.exe",
    "command prompt": "cmd.exe",
    "cmd": "cmd.exe",
    "powershell": "powershell.exe",
    "chrome": "chrome.exe",
    "google chrome": "chrome.exe",
    "edge": "msedge.exe",
    "microsoft edge": "msedge.exe",
    "code": "code",
    "vs code": "code",
    "vscode": "code",
    "spotify": "spotify:",
    "discord": "discord:",
    "settings": "ms-settings:",
}

# Process names for termination
PROCESS_MAP = {
    "notepad": "notepad.exe",
    "calculator": "CalculatorApp.exe",
    "calc": "CalculatorApp.exe",
    "paint": "mspaint.exe",
    "mspaint": "mspaint.exe",
    "chrome": "chrome.exe",
    "google chrome": "chrome.exe",
    "edge": "msedge.exe",
    "microsoft edge": "msedge.exe",
    "cmd": "cmd.exe",
    "command prompt": "cmd.exe",
    "powershell": "powershell.exe",
    "task manager": "taskmgr.exe",
    "taskmgr": "taskmgr.exe",
    "spotify": "Spotify.exe",
    "discord": "Discord.exe",
    "code": "Code.exe",
    "vs code": "Code.exe",
}

SYSTEM_ACTIONS = {
    "mute": "mute",
    "unmute": "unmute",
    "volume up": "volume up",
    "volume down": "volume down",
    "lock": "lock",
    "lock workstation": "lock",
    "sleep": "sleep",
    "open task manager": "open task manager",
    "open settings": "open settings",
    "open wifi settings": "open wifi settings",
    "open bluetooth settings": "open bluetooth settings",
    "open display settings": "open display settings",
    "open power & sleep": "open power & sleep",
    "open default apps": "open default apps",
}


def _result(ok: bool, action: str, target: str = "", detail: str = "", **extra: Any) -> dict[str, Any]:
    payload = {"ok": ok, "action": action, "target": target, "detail": detail}
    payload.update(extra)
    return payload


def _open_url(url: str, action: str = "browser_open") -> dict[str, Any]:
    try:
        opened = webbrowser.open(url, new=2)
        return _result(True, action, url, "Opened in default browser", url=url)
    except Exception as exc:
        return _result(False, action, url, f"Browser open failed: {exc}", url=url)


def _known_url(target: str) -> str | None:
    cleaned = target.strip().lower()
    if cleaned in URL_ALIASES:
        return URL_ALIASES[cleaned]
    if re.match(r"^(https?://|www\.)", cleaned):
        return target if cleaned.startswith("http") else f"https://{target}"
    if re.match(r"^[\w.-]+\.[a-z]{2,}([/:].*)?$", cleaned):
        return f"https://{target}"
    return None


def Open(target: str) -> dict[str, Any]:
    cleaned = target.strip().lower()
    if not cleaned:
        return _result(False, "open", target, "No target specified")

    # 1. Check known URL aliases
    url = _known_url(cleaned)
    if url:
        return _open_url(url, "open_url")

    # 2. Check known Windows Application / URI map
    if cleaned in APP_MAP:
        mapped = APP_MAP[cleaned]
        try:
            if mapped.endswith(":"):
                os.startfile(mapped)
            else:
                subprocess.Popen(mapped, shell=True)
            return _result(True, "open_app", target, f"Launched {mapped}")
        except Exception as exc:
            pass

    # 3. Direct Windows native launch
    if os.name == "nt":
        try:
            os.startfile(target)
            return _result(True, "open_app", target, f"Launched {target}")
        except Exception:
            pass

        try:
            subprocess.Popen(f'start "" "{target}"', shell=True)
            return _result(True, "open_app", target, f"Launched {target}")
        except Exception:
            pass

    # 4. Fallback to DuckDuckGo search
    return _open_url(f"https://duckduckgo.com/?q={quote_plus(target)}", "web_search_fallback")


def Close(target: str) -> dict[str, Any]:
    cleaned = target.strip().lower()
    if not cleaned:
        return _result(False, "close", target, "No target specified")

    proc_name = PROCESS_MAP.get(cleaned, cleaned if cleaned.endswith(".exe") else f"{cleaned}.exe")

    if os.name == "nt":
        try:
            res = subprocess.run(["taskkill", "/IM", proc_name, "/F", "/T"], capture_output=True, text=True, timeout=5)
            if res.returncode == 0 or "SUCCESS" in res.stdout:
                return _result(True, "close_app", target, f"Closed {proc_name}")
        except Exception:
            pass

        # Try base process name without .exe
        try:
            base = proc_name.replace(".exe", "")
            subprocess.run(["taskkill", "/IM", f"{base}.exe", "/F", "/T"], capture_output=True, timeout=5)
            return _result(True, "close_app", target, f"Closed {target}")
        except Exception:
            pass

    return _result(False, "close_app", target, f"Application {target} was not running or could not be closed")


OpenApp = Open
CloseApp = Close


def DuckDuckGoSearch(topic: str) -> dict[str, Any]:
    return _open_url(f"https://duckduckgo.com/?q={quote_plus(topic.strip())}", "duckduckgo_search")

def GoogleSearch(topic: str) -> dict[str, Any]:
    return DuckDuckGoSearch(topic)


def YouTubeSearch(topic: str) -> dict[str, Any]:
    return _open_url(f"https://www.youtube.com/results?search_query={quote_plus(topic.strip())}", "youtube_search")


def PlayYoutube(query: str) -> dict[str, Any]:
    clean_query = query.strip()
    return _open_url(f"https://www.youtube.com/results?search_query={quote_plus(clean_query)}", "play_youtube")


def _press_media(key: str) -> dict[str, Any]:
    if keyboard is None:
        return _result(False, "system", key, "Keyboard automation module unavailable")
    try:
        keyboard.press_and_release(key)
        return _result(True, "system", key, f"Sent media key: {key}")
    except Exception as exc:
        return _result(False, "system", key, f"Media key failed: {exc}")


def _windows_system(command: str) -> dict[str, Any]:
    if os.name != "nt":
        return _result(False, "system", command, "Windows system action requested on non-Windows host")
    try:
        if command == "lock" or command == "lock workstation":
            subprocess.Popen(["rundll32.exe", "user32.dll,LockWorkStation"])
        elif command == "sleep":
            subprocess.Popen(["rundll32.exe", "powrprof.dll,SetSuspendState", "0,1,0"])
        elif command == "open task manager":
            subprocess.Popen(["taskmgr.exe"])
        elif command == "open settings":
            os.startfile("ms-settings:")
        elif command == "open wifi settings":
            os.startfile("ms-settings:network-wifi")
        elif command == "open bluetooth settings":
            os.startfile("ms-settings:bluetooth")
        elif command == "open sound settings":
            os.startfile("ms-settings:sound")
        elif command == "open display settings":
            os.startfile("ms-settings:display")
        elif command == "open power & sleep":
            os.startfile("ms-settings:powersleep")
        elif command == "open default apps":
            os.startfile("ms-settings:defaultapps")
        else:
            return _result(False, "system", command, f"Unsupported action: {command}")
        return _result(True, "system", command, f"Executed {command}")
    except Exception as exc:
        return _result(False, "system", command, f"System action error: {exc}")


def System(command: str) -> dict[str, Any]:
    normalized = command.strip().lower()
    if normalized in {"mute", "unmute", "volume up", "volume down"}:
        media_map = {"mute": "volume mute", "unmute": "volume mute", "volume up": "volume up", "volume down": "volume down"}
        return _press_media(media_map[normalized])
    if normalized in SYSTEM_ACTIONS:
        return _windows_system(SYSTEM_ACTIONS[normalized])
    return _result(False, "system", command, f"Unknown system command: {command}")


def Content(topic: str) -> dict[str, Any]:
    clean_topic = topic.strip()
    safe_name = re.sub(r"[^a-zA-Z0-9_-]+", "", clean_topic.lower().replace(" ", "_"))[:80] or "jarvis_content"
    path = DATA_DIR / f"{safe_name}.txt"

    text = f"Content generated for: {clean_topic}\n\n"
    if Groq and GROQ_KEY:
        try:
            client = Groq(api_key=GROQ_KEY)
            response = client.chat.completions.create(
                model="llama-3.1-8b-instant",
                messages=[
                    {"role": "system", "content": f"You are a professional content writer for {USERNAME}."},
                    {"role": "user", "content": clean_topic}
                ],
                max_tokens=2048,
                temperature=0.7
            )
            text += response.choices[0].message.content or ""
        except Exception as exc:
            text += f"(AI completion error: {exc})\n"
    else:
        text += "Groq API key not configured. Please enter your API key in JARVIS settings."

    try:
        path.write_text(text, encoding="utf-8")
        if os.name == "nt":
            subprocess.Popen(["notepad.exe", str(path)])
        return _result(True, "content", clean_topic, f"Saved to {path.name} and opened in Notepad", file=str(path))
    except Exception as exc:
        return _result(False, "content", clean_topic, f"Failed to save content: {exc}")


def _dispatch(command: str) -> dict[str, Any]:
    normalized = command.strip()
    lowered = normalized.lower()
    if lowered.startswith("open "):
        return Open(normalized[5:])
    if lowered.startswith("close "):
        return Close(normalized[6:])
    if lowered.startswith("play "):
        return PlayYoutube(normalized[5:])
    if lowered.startswith("content "):
        return Content(normalized[8:])
    if lowered.startswith("duckduckgo search "):
        return DuckDuckGoSearch(normalized[18:])
    if lowered.startswith("web search "):
        return DuckDuckGoSearch(normalized[11:])
    if lowered.startswith("google search "):
        return DuckDuckGoSearch(normalized[14:])
    if lowered.startswith("search "):
        return DuckDuckGoSearch(normalized[7:])
    if lowered.startswith("youtube search "):
        return YouTubeSearch(normalized[15:])
    if lowered.startswith("system "):
        return System(normalized[7:])
    return _result(False, "unrecognized", normalized, "No automation route matched")


async def TranslateAndExecute(commands: list[str]) -> list[dict[str, Any]]:
    tasks = [asyncio.to_thread(_dispatch, command) for command in commands if command.strip()]
    return await asyncio.gather(*tasks) if tasks else []


async def Automation(commands: list[str]) -> dict[str, Any]:
    results = await TranslateAndExecute(commands)
    return {"ok": bool(results) and any(item.get("ok") for item in results), "commands": commands, "results": results}
