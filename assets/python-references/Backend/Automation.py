"""Safe, Electron-callable automation for the imported JARVIS backend.

The original project assumed every target was a locally installed application. This
module keeps that behavior as the first attempt, then falls back to a browser URL or
web search when an application is unavailable. System operations are deliberately
allowlisted; arbitrary shell commands are not accepted.
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
    from AppOpener import close as app_close, open as app_open
except Exception:
    app_open = None
    app_close = None

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
    "reddit": "https://www.reddit.com/",
}

APP_ALIASES = {
    "notepad": "notepad.exe",
    "calculator": "calc.exe",
    "calc": "calc.exe",
    "paint": "mspaint.exe",
    "file explorer": "explorer.exe",
    "explorer": "explorer.exe",
    "task manager": "taskmgr.exe",
    "command prompt": "cmd.exe",
    "cmd": "cmd.exe",
    "powershell": "powershell.exe",
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
}


def _result(ok: bool, action: str, target: str = "", detail: str = "", **extra: Any) -> dict[str, Any]:
    payload = {"ok": ok, "action": action, "target": target, "detail": detail}
    payload.update(extra)
    return payload


def _open_url(url: str, action: str = "browser_open") -> dict[str, Any]:
    try:
        opened = webbrowser.open(url, new=2)
        return _result(bool(opened), action, url, "Opened in the default browser" if opened else "Browser rejected the URL", url=url)
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


def _web_fallback(target: str) -> dict[str, Any]:
    url = _known_url(target)
    if url:
        return _open_url(url, "browser_fallback")
    return _open_url(f"https://www.google.com/search?q={quote_plus(target)}", "web_search_fallback")


def _native_app(target: str) -> dict[str, Any] | None:
    cleaned = target.strip().lower()
    executable = APP_ALIASES.get(cleaned)
    if executable and shutil.which(executable):
        try:
            subprocess.Popen([executable], cwd=str(ROOT), close_fds=True)
            return _result(True, "native_app", target, f"Launched {executable}", executable=executable)
        except Exception as exc:
            return _result(False, "native_app", target, f"Native launch failed: {exc}", executable=executable)
    if app_open:
        try:
            app_open(target, match_closest=True, output=False, throw_error=True)
            return _result(True, "native_app", target, "Launched installed application")
        except Exception:
            return None
    return None


def OpenApp(app: str) -> dict[str, Any]:
    """Open an installed application, or use a browser fallback when absent."""
    target = app.strip()
    if not target:
        return _result(False, "open", target, "No application or service was specified")
    known = _known_url(target)
    # Web-first aliases avoid AppOpener incorrectly interpreting YouTube or Gmail
    # as a Windows process name.
    if known:
        return _open_url(known, "browser_open")
    native = _native_app(target)
    if native and native.get("ok"):
        return native
    return _web_fallback(target)


def CloseApp(app: str) -> dict[str, Any]:
    target = app.strip()
    if not target:
        return _result(False, "close", target, "No application was specified")
    if app_close:
        try:
            app_close(target, match_closest=True, output=False, throw_error=True)
            return _result(True, "close", target, "Closed installed application")
        except Exception:
            pass
    process_map = {"chrome": "chrome.exe", "google chrome": "chrome.exe", "edge": "msedge.exe", "microsoft edge": "msedge.exe", "notepad": "notepad.exe", "calculator": "CalculatorApp.exe"}
    process = process_map.get(target.lower())
    if process and os.name == "nt":
        try:
            subprocess.run(["taskkill", "/IM", process, "/T"], check=False, capture_output=True, text=True, timeout=8)
            return _result(True, "close_process", target, f"Requested close for {process}", process=process)
        except Exception as exc:
            return _result(False, "close_process", target, f"Process close failed: {exc}", process=process)
    return _result(False, "close", target, "Application is not installed, open, or supported for close")


def GoogleSearch(topic: str) -> dict[str, Any]:
    return _open_url(f"https://www.google.com/search?q={quote_plus(topic.strip())}", "google_search")


def YouTubeSearch(topic: str) -> dict[str, Any]:
    return _open_url(f"https://www.youtube.com/results?search_query={quote_plus(topic.strip())}", "youtube_search")


def PlayYoutube(query: str) -> dict[str, Any]:
    return _open_url(f"https://www.youtube.com/results?search_query={quote_plus(query.strip())}", "youtube_play_fallback")


def _press_media(key: str) -> dict[str, Any]:
    if keyboard is None:
        return _result(False, "system", key, "Python keyboard dependency is unavailable")
    try:
        keyboard.press_and_release(key)
        return _result(True, "system", key, f"Sent media key: {key}")
    except Exception as exc:
        return _result(False, "system", key, f"Media key failed: {exc}")


def _windows_system(command: str) -> dict[str, Any]:
    if os.name != "nt":
        return _result(False, "system", command, "Windows system action requested on a non-Windows host")
    try:
        if command == "lock":
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
        elif command == "open display settings":
            os.startfile("ms-settings:display")
        else:
            return _result(False, "system", command, "System action is not allowlisted")
        return _result(True, "system", command, "Windows system action dispatched")
    except Exception as exc:
        return _result(False, "system", command, f"Windows system action failed: {exc}")


def System(command: str) -> dict[str, Any]:
    normalized = " ".join(command.strip().lower().split())
    if normalized not in SYSTEM_ACTIONS:
        return _result(False, "system", normalized, "Unsupported system action; arbitrary shell commands are disabled")
    if normalized in {"mute", "unmute", "volume up", "volume down"}:
        return _press_media({"mute": "volume mute", "unmute": "volume mute", "volume up": "volume up", "volume down": "volume down"}[normalized])
    return _windows_system(SYSTEM_ACTIONS[normalized])


def Content(topic: str) -> dict[str, Any]:
    """Generate a text file when Groq is configured; never blocks app launch."""
    if Groq is None or not GROQ_KEY:
        return _result(False, "content", topic, "Groq is not configured for Python content generation")
    try:
        client = Groq(api_key=GROQ_KEY)
        response = client.chat.completions.create(model="llama-3.1-8b-instant", messages=[{"role": "system", "content": f"You are a professional content writer for {USERNAME}."}, {"role": "user", "content": topic}], max_tokens=2048, temperature=0.7)
        text = response.choices[0].message.content or ""
        safe_name = re.sub(r"[^a-zA-Z0-9_-]+", "", topic.lower().replace(" ", "_"))[:80] or "jarvis_content"
        path = DATA_DIR / f"{safe_name}.txt"
        path.write_text(text, encoding="utf-8")
        native = _native_app("notepad")
        if native and native.get("ok") and os.name == "nt":
            subprocess.Popen(["notepad.exe", str(path)])
        return _result(True, "content", topic, "Content generated", file=str(path))
    except Exception as exc:
        return _result(False, "content", topic, f"Content generation failed: {exc}")


def _dispatch(command: str) -> dict[str, Any]:
    normalized = command.strip()
    lowered = normalized.lower()
    if lowered.startswith("open "):
        return OpenApp(normalized[5:])
    if lowered.startswith("close "):
        return CloseApp(normalized[6:])
    if lowered.startswith("play "):
        return PlayYoutube(normalized[5:])
    if lowered.startswith("content "):
        return Content(normalized[8:])
    if lowered.startswith("google search "):
        return GoogleSearch(normalized[14:])
    if lowered.startswith("youtube search "):
        return YouTubeSearch(normalized[15:])
    if lowered.startswith("system "):
        return System(normalized[7:])
    return _result(False, "unrecognized", normalized, "No approved automation route matched this command")


async def TranslateAndExecute(commands: list[str]) -> list[dict[str, Any]]:
    tasks = [asyncio.to_thread(_dispatch, command) for command in commands if command.strip()]
    return await asyncio.gather(*tasks) if tasks else []


async def Automation(commands: list[str]) -> dict[str, Any]:
    results = await TranslateAndExecute(commands)
    return {"ok": bool(results) and all(item.get("ok") for item in results), "commands": commands, "results": results}
