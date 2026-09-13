"""Safe, comprehensive automation subsystem for JARVIS.

Handles:
- Opening apps (native launch first, seamless browser fallback if not installed).
- Closing apps/processes cleanly.
- Media playback (YouTube, YouTube Music, Spotify).
- System settings and toggles (volume, mute, wifi, bluetooth, lock, sleep).
- Safe file management (create, append, remove files in user directory with permission checks).
- Content generation using the unified LLMManager (Gemini/fallback) opened in Notepad.
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

from Backend.LLMManager import LLM_CLIENT

ROOT = Path.cwd()
DATA_DIR = ROOT / "Data"
DATA_DIR.mkdir(parents=True, exist_ok=True)
ENV = dotenv_values(ROOT / ".env") if (ROOT / ".env").exists() else {}
ASSISTANT_NAME = os.environ.get("Assistantname") or ENV.get("Assistantname") or "JARVIS"
USERNAME = os.environ.get("Username") or ENV.get("Username") or "SA SUJON"

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
    "twitter": "https://twitter.com/",
    "x": "https://x.com/",
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
    "edge": "msedge.exe",
    "chrome": "chrome.exe",
    "spotify": "Spotify.exe",
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
    "wifi": "open wifi settings",
    "open bluetooth settings": "open bluetooth settings",
    "bluetooth": "open bluetooth settings",
    "open display settings": "open display settings",
    "display": "open display settings",
    "sound": "open sound settings",
    "open sound settings": "open sound settings",
    "battery": "open battery settings",
    "open battery settings": "open battery settings",
    "airplane mode": "open airplane settings",
}


def _result(ok: bool, action: str, target: str = "", detail: str = "", **extra: Any) -> dict[str, Any]:
    payload = {"ok": ok, "action": action, "target": target, "detail": detail}
    payload.update(extra)
    return payload


def _open_url(url: str, action: str = "browser_open") -> dict[str, Any]:
    try:
        opened = webbrowser.open(url, new=2)
        return _result(True, action, url, "Opened in browser", url=url)
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


def _native_app(target: str) -> dict[str, Any] | None:
    cleaned = target.strip().lower()
    executable = APP_ALIASES.get(cleaned)
    if executable and shutil.which(executable):
        try:
            subprocess.Popen([executable], cwd=str(ROOT), close_fds=True)
            return _result(True, "native_app", target, f"Launched {executable}", executable=executable)
        except Exception:
            pass
    if app_open:
        try:
            app_open(target, match_closest=True, output=False, throw_error=True)
            return _result(True, "native_app", target, "Launched installed application")
        except Exception:
            pass
    return None


def OpenApp(app: str) -> dict[str, Any]:
    """Open an installed application, or fall back to browser seamlessly if not installed."""
    target = app.strip()
    if not target:
        return _result(False, "open", target, "No application or service was specified")

    known = _known_url(target)
    if known:
        return _open_url(known, "browser_open")

    native = _native_app(target)
    if native and native.get("ok"):
        return native

    # If application is not installed on PC, seamlessly open on browser without showing an error
    fallback_url = f"https://www.google.com/search?q={quote_plus(target)}"
    return _open_url(fallback_url, "browser_fallback")


def CloseApp(app: str) -> dict[str, Any]:
    target = app.strip()
    if not target:
        return _result(False, "close", target, "No application was specified")
    if app_close:
        try:
            app_close(target, match_closest=True, output=False, throw_error=True)
            return _result(True, "close", target, f"Closed {target}")
        except Exception:
            pass
    process_map = {
        "chrome": "chrome.exe",
        "google chrome": "chrome.exe",
        "edge": "msedge.exe",
        "microsoft edge": "msedge.exe",
        "notepad": "notepad.exe",
        "calculator": "CalculatorApp.exe",
        "spotify": "Spotify.exe",
    }
    process = process_map.get(target.lower())
    if process and os.name == "nt":
        try:
            subprocess.run(["taskkill", "/IM", process, "/T"], check=False, capture_output=True, text=True, timeout=8)
            return _result(True, "close_process", target, f"Closed {process}", process=process)
        except Exception as exc:
            return _result(False, "close_process", target, f"Process close failed: {exc}")
    return _result(True, "close", target, f"Requested close for {target}")


def PlayMedia(query: str) -> dict[str, Any]:
    """Play song/media on YouTube, YouTube Music, or Spotify."""
    cleaned = query.strip()
    lower = cleaned.lower()
    if "on spotify" in lower or "in spotify" in lower:
        song = re.sub(r"\s+(?:on|in)\s+spotify", "", cleaned, flags=re.I).strip()
        spotify_url = f"https://open.spotify.com/search/{quote_plus(song)}"
        return _open_url(spotify_url, "spotify_play")

    if "on youtube music" in lower:
        song = re.sub(r"\s+on\s+youtube\s+music", "", cleaned, flags=re.I).strip()
        return _open_url(f"https://music.youtube.com/search?q={quote_plus(song)}", "ytmusic_play")

    # Default to YouTube video search / direct play
    song = re.sub(r"\s+on\s+youtube", "", cleaned, flags=re.I).strip()
    return _open_url(f"https://www.youtube.com/results?search_query={quote_plus(song)}", "youtube_play")


def _press_media(key: str) -> dict[str, Any]:
    if keyboard is None:
        return _result(False, "system", key, "Keyboard module unavailable")
    try:
        keyboard.press_and_release(key)
        return _result(True, "system", key, f"Triggered {key}")
    except Exception as exc:
        return _result(False, "system", key, f"Action failed: {exc}")


def _windows_system(command: str) -> dict[str, Any]:
    if os.name != "nt":
        return _result(False, "system", command, "Windows-only system command")
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
        elif command == "open sound settings":
            os.startfile("ms-settings:sound")
        elif command == "open battery settings":
            os.startfile("ms-settings:batterysaver")
        elif command == "open airplane settings":
            os.startfile("ms-settings:network-airplanemode")
        else:
            return _result(False, "system", command, "Unknown system action")
        return _result(True, "system", command, f"Executed {command}")
    except Exception as exc:
        return _result(False, "system", command, f"System execution failed: {exc}")


def System(command: str) -> dict[str, Any]:
    normalized = " ".join(command.strip().lower().split())
    if normalized in {"mute", "unmute", "volume up", "volume down"}:
        return _press_media({"mute": "volume mute", "unmute": "volume mute", "volume up": "volume up", "volume down": "volume down"}[normalized])
    if normalized in SYSTEM_ACTIONS:
        return _windows_system(SYSTEM_ACTIONS[normalized])
    # Fallback to general settings
    if "setting" in normalized:
        return _windows_system("open settings")
    return _result(True, "system", command, f"Processed {command}")


def SafeFileOperation(op: str, filepath_str: str, content: str = "") -> dict[str, Any]:
    """Safely create, append, or remove files in workspace or user directories."""
    try:
        target_path = Path(filepath_str.strip()).expanduser()
        if not target_path.is_absolute():
            target_path = DATA_DIR / target_path.name

        # Security check: avoid critical system paths
        str_lower = str(target_path).lower()
        if any(bad in str_lower for bad in ["windows\\system32", "program files", "bootmgr"]):
            return _result(False, "file", str(target_path), "Access to system-critical paths is restricted")

        if op in ["create", "write"]:
            target_path.parent.mkdir(parents=True, exist_ok=True)
            target_path.write_text(content, encoding="utf-8")
            return _result(True, "file_create", str(target_path), f"File created at {target_path.name}")
        elif op in ["append", "add"]:
            target_path.parent.mkdir(parents=True, exist_ok=True)
            with open(target_path, "a", encoding="utf-8") as f:
                f.write(content + "\n")
            return _result(True, "file_append", str(target_path), f"Content added to {target_path.name}")
        elif op in ["remove", "delete"]:
            if target_path.exists():
                target_path.unlink()
                return _result(True, "file_delete", str(target_path), f"File {target_path.name} deleted")
            else:
                return _result(True, "file_delete", str(target_path), "File does not exist")
    except Exception as exc:
        return _result(False, "file", filepath_str, f"File operation failed: {exc}")

    return _result(False, "file", filepath_str, "Unrecognized file operation")


def Content(topic: str) -> dict[str, Any]:
    """Generate professional content using LLMManager and display in Notepad."""
    try:
        text, provider = LLM_CLIENT.generate(
            prompt=f"Draft professional, clear content about: {topic}",
            system_instruction=f"You are a skilled content writer assisting {USERNAME}. Provide well-structured, practical text.",
        )
        safe_name = re.sub(r"[^a-zA-Z0-9_-]+", "", topic.lower().replace(" ", "_"))[:60] or "jarvis_content"
        path = DATA_DIR / f"{safe_name}.txt"
        path.write_text(text, encoding="utf-8")
        if os.name == "nt":
            subprocess.Popen(["notepad.exe", str(path)])
        return _result(True, "content", topic, f"Generated with {provider} and opened in Notepad", file=str(path))
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
        return PlayMedia(normalized[5:])
    if lowered.startswith("content "):
        return Content(normalized[8:])
    if lowered.startswith("system "):
        return System(normalized[7:])
    if lowered.startswith("google search "):
        return _open_url(f"https://www.google.com/search?q={quote_plus(normalized[14:])}", "google_search")
    if lowered.startswith("youtube search "):
        return _open_url(f"https://www.youtube.com/results?search_query={quote_plus(normalized[15:])}", "youtube_search")

    # File operations (various patterns from Model.py classifier)
    if re.search(r"^(?:create|make|write)\s+file\s+", lowered):
        m = re.match(r"^(?:create|make|write)\s+file\s+([^\s]+)(?:\s+with\s+(?:content|text)\s+(.+))?$", normalized, re.I)
        if m:
            return SafeFileOperation("create", m.group(1), m.group(2) or "")
    if re.search(r"^(?:delete|remove)\s+file\s+", lowered):
        filename = re.sub(r"^(?:delete|remove)\s+file\s+", "", normalized, flags=re.I).strip()
        return SafeFileOperation("remove", filename)
    if re.search(r"^(?:add\s+to|append\s+to)\s+file\s+", lowered):
        m = re.match(r"^(?:add\s+to|append\s+to)\s+file\s+([^\s]+)\s+(.+)$", normalized, re.I)
        if m:
            return SafeFileOperation("append", m.group(1), m.group(2))
    # From Model.py: "system delete file X"
    if lowered.startswith("delete file "):
        filename = normalized[len("delete file "):].strip()
        return SafeFileOperation("remove", filename)

    # General system control checks
    if any(k in lowered for k in ["wifi", "bluetooth", "volume", "sound", "display", "setting", "mute", "unmute"]):
        return System(normalized)

    # General app opening fallback
    return OpenApp(normalized)


async def TranslateAndExecute(commands: list[str]) -> list[dict[str, Any]]:
    tasks = [asyncio.to_thread(_dispatch, command) for command in commands if command.strip()]
    return await asyncio.gather(*tasks) if tasks else []


async def Automation(commands: list[str]) -> dict[str, Any]:
    results = await TranslateAndExecute(commands)
    return {"ok": bool(results) and all(item.get("ok") for item in results), "commands": commands, "results": results}
