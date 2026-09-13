"""JARVIS Live Speech-to-Text Engine.

Primary: Python SpeechRecognition library (uses Google Web Speech API via microphone).
Secondary: Hidden Chrome WebDriver with Web Speech API (non-headless, minimized window).

NOTE: Chrome --headless mode does NOT support Web Speech API at all.
The Chrome fallback uses a visible-but-minimized window to get around this limitation.
"""
from __future__ import annotations

import os
import sys
import time
from pathlib import Path
from dotenv import dotenv_values

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "Data"
DATA_DIR.mkdir(parents=True, exist_ok=True)
TEMP_DIR = ROOT / "Frontend" / "Files"
TEMP_DIR.mkdir(parents=True, exist_ok=True)

env_vars = dotenv_values(ROOT / ".env") if (ROOT / ".env").exists() else {}
InputLanguage = (
    os.environ.get("JARVIS_INPUT_LANGUAGE")
    or os.environ.get("InputLanguage")
    or env_vars.get("InputLanguage")
    or "en-US"
)

VOICE_HTML_PATH = DATA_DIR / "Voice.html"

# Attempt mtranslate import for translation support
try:
    import mtranslate as mt
except ImportError:
    mt = None


def SetAssistantStatus(status: str) -> None:
    try:
        TEMP_DIR.mkdir(parents=True, exist_ok=True)
        with open(TEMP_DIR / "Status.data", "w", encoding="utf-8") as f:
            f.write(status)
    except Exception:
        pass


def QueryModifier(query: str) -> str:
    new_query = query.lower().strip()
    if not new_query:
        return ""
    query_words = new_query.split()
    question_words = [
        "how", "what", "who", "where", "when", "why", "which",
        "whose", "whom", "can you", "what's", "where's", "how's", "could you",
    ]

    is_question = any(word in new_query for word in question_words)
    if is_question:
        if query_words[-1][-1] in [".", "?", "!"]:
            new_query = new_query[:-1] + "?"
        else:
            new_query += "?"
    else:
        if query_words[-1][-1] in [".", "?", "!"]:
            new_query = new_query[:-1] + "."
        else:
            new_query += "."

    return new_query.capitalize()


def UniversalTranslator(text: str) -> str:
    if not mt:
        return text.capitalize()
    try:
        translated = mt.translate(text, "en", "auto")
        return translated.capitalize()
    except Exception:
        return text.capitalize()


class NativeSpeechRecognizer:
    """Primary STT: Uses Python speech_recognition library with the system microphone.

    This is the most reliable approach — it captures from the real physical
    microphone and sends audio to Google's Web Speech API for transcription.
    """

    def __init__(self) -> None:
        import speech_recognition as sr

        self.sr = sr
        self.recognizer = sr.Recognizer()
        self.recognizer.pause_threshold = 0.8
        self.recognizer.phrase_threshold = 0.3
        self.recognizer.non_speaking_duration = 0.5

        # Test that the microphone is accessible
        self.microphone = sr.Microphone()
        with self.microphone as source:
            self.recognizer.adjust_for_ambient_noise(source, duration=0.6)
            # Cap threshold so background noise on PC mic arrays does not make it deaf
            self.recognizer.energy_threshold = max(250, min(self.recognizer.energy_threshold, 500))
        self.recognizer.dynamic_energy_threshold = False
        sys.stderr.write("NativeSpeechRecognizer: Microphone initialized successfully.\n")

    def listen_once(self, timeout_sec: float = 10.0) -> str:
        # Normalize language for Google Web Speech API (e.g. "en" -> "en-US")
        target_lang = InputLanguage.strip() if InputLanguage else "en-US"
        if target_lang.lower() in ("en", "en-us"):
            target_lang = "en-US"

        try:
            with self.microphone as source:
                audio = self.recognizer.listen(
                    source, timeout=timeout_sec, phrase_time_limit=15.0
                )
            # Use Google Web Speech API (free, no key needed)
            text = self.recognizer.recognize_google(audio, language=target_lang)
            if text:
                sys.stderr.write(f"[STT] Heard: {text}\n")
                lang_lower = target_lang.lower()
                if "en" in lang_lower:
                    return QueryModifier(text)
                else:
                    SetAssistantStatus("Translating...")
                    return QueryModifier(UniversalTranslator(text))
        except self.sr.WaitTimeoutError:
            # No speech detected within timeout — not an error
            return ""
        except self.sr.UnknownValueError:
            # Speech was unintelligible
            return ""
        except self.sr.RequestError as exc:
            sys.stderr.write(f"NativeSpeechRecognizer: Google API error: {exc}\n")
        except Exception as exc:
            sys.stderr.write(f"NativeSpeechRecognizer: Error: {exc}\n")
        return ""


class ChromeSpeechRecognizer:
    """Secondary STT: Uses Chrome WebDriver with Web Speech API.

    IMPORTANT: Chrome's Web Speech API does NOT work in --headless mode.
    We use a normal (non-headless) Chrome window but position it off-screen
    and minimize it so it's invisible to the user.
    """

    def __init__(self) -> None:
        self.driver = None
        self._ensure_voice_html()
        self._init_driver()

    def _ensure_voice_html(self) -> None:
        """Ensure Voice.html exists with the latest speech recognition code."""
        if not VOICE_HTML_PATH.exists():
            VOICE_HTML_PATH.write_text(
                """<!DOCTYPE html>
<html lang="en">
<head><title>Speech</title></head>
<body>
<button id="start" onclick="startRecognition()">Start</button>
<button id="end" onclick="stopRecognition()">Stop</button>
<p id="output"></p>
<script>
let recognition = null;
let isStarted = false;
function startRecognition() {
    if (isStarted && recognition) return;
    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRec) return;
    recognition = new SpeechRec();
    recognition.lang = '"""
                + InputLanguage
                + """';
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.onresult = (e) => {
        const latest = e.results[e.results.length - 1];
        if (latest.isFinal && latest[0]) {
            const t = latest[0].transcript.trim();
            if (t) document.getElementById('output').textContent = t;
        }
    };
    recognition.onend = () => { if (isStarted) setTimeout(() => { try { recognition.start(); } catch(e){} }, 250); };
    recognition.onerror = (e) => { if (e.error !== 'not-allowed' && isStarted) setTimeout(() => { try { recognition.start(); } catch(e2){} }, 500); };
    isStarted = true;
    recognition.start();
}
function stopRecognition() { isStarted = false; if (recognition) try { recognition.stop(); } catch(e){} }
window.addEventListener('DOMContentLoaded', () => setTimeout(startRecognition, 300));
</script>
</body>
</html>""",
                encoding="utf-8",
            )

    def _init_driver(self) -> None:
        from selenium import webdriver
        from selenium.webdriver.chrome.options import Options
        from selenium.webdriver.chrome.service import Service

        chrome_options = Options()
        user_agent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        chrome_options.add_argument(f"user-agent={user_agent}")
        # Auto-grant mic permission without user prompt dialog
        chrome_options.add_argument("--use-fake-ui-for-media-stream")
        # CRITICAL: DO NOT use --use-fake-device-for-media-stream — that replaces real mic with beep audio!
        # CRITICAL: DO NOT use --headless — Web Speech API does NOT work in headless mode!
        # Instead, position the window off-screen so it's invisible
        chrome_options.add_argument("--window-position=-9999,-9999")
        chrome_options.add_argument("--window-size=1,1")
        chrome_options.add_argument("--disable-gpu")
        chrome_options.add_argument("--no-sandbox")
        chrome_options.add_argument("--disable-dev-shm-usage")
        chrome_options.add_argument("--autoplay-policy=no-user-gesture-required")
        chrome_options.add_argument("--allow-file-access-from-files")
        chrome_options.add_experimental_option(
            "prefs",
            {
                "profile.default_content_setting_values.media_stream_mic": 1,
                "profile.default_content_setting_values.notifications": 1,
            },
        )

        # Check local driver binary paths first
        candidate_drivers = [
            ROOT / "drivers" / "chromedriver.exe",
            ROOT.parent.parent / "drivers" / "chromedriver.exe",
            Path(__file__).parent / "chromedriver.exe",
            Path("drivers/chromedriver.exe").resolve(),
        ]
        local_driver = next((str(p) for p in candidate_drivers if p.exists()), None)
        if local_driver:
            try:
                service = Service(executable_path=local_driver)
                self.driver = webdriver.Chrome(service=service, options=chrome_options)
            except Exception as exc:
                sys.stderr.write(f"Local ChromeDriver ({local_driver}) failed: {exc}\n")

        if not self.driver:
            try:
                # First attempt Selenium 4.10+ built-in Selenium Manager
                self.driver = webdriver.Chrome(options=chrome_options)
            except Exception:
                try:
                    # Fallback to webdriver_manager if available
                    from webdriver_manager.chrome import ChromeDriverManager

                    service = Service(ChromeDriverManager().install())
                    self.driver = webdriver.Chrome(service=service, options=chrome_options)
                except Exception as exc:
                    raise RuntimeError(f"Could not start Chrome WebDriver for STT: {exc}")

        # Minimize the window immediately
        try:
            self.driver.minimize_window()
        except Exception:
            pass

        # Navigate to the Voice.html page once
        voice_url = VOICE_HTML_PATH.resolve().as_uri()
        self.driver.get(voice_url)
        time.sleep(0.5)

        # Trigger start
        try:
            self.driver.execute_script("if (typeof startRecognition === 'function') startRecognition();")
        except Exception:
            pass
        try:
            from selenium.webdriver.common.by import By

            self.driver.find_element(By.ID, "start").click()
        except Exception:
            pass

    def listen_once(self, timeout_sec: float = 30.0) -> str:
        from selenium.webdriver.common.by import By

        start_time = time.time()
        try:
            self.driver.execute_script(
                "if (typeof isStarted !== 'undefined' && !isStarted && typeof startRecognition === 'function') { startRecognition(); }"
            )
        except Exception:
            pass

        while time.time() - start_time < timeout_sec:
            try:
                output_elem = self.driver.find_element(By.ID, "output")
                text = output_elem.text.strip()
                if text:
                    # Clear the output in the page so it's ready for the next phrase
                    self.driver.execute_script(
                        "document.getElementById('output').textContent = '';"
                    )
                    lang_lower = InputLanguage.lower()
                    if lang_lower == "en" or "en-" in lang_lower:
                        return QueryModifier(text)
                    else:
                        SetAssistantStatus("Translating...")
                        return QueryModifier(UniversalTranslator(text))
            except Exception:
                pass
            time.sleep(0.1)

        return ""

    def close(self) -> None:
        if self.driver:
            try:
                self.driver.quit()
            except Exception:
                pass
            self.driver = None


def get_recognizer():
    """Initialize STT: try Python SpeechRecognition first (most reliable),
    then fall back to Chrome WebDriver if the microphone library isn't available."""
    try:
        return NativeSpeechRecognizer()
    except Exception as native_err:
        sys.stderr.write(
            f"Python SpeechRecognition STT failed ({native_err}), "
            f"falling back to Chrome WebDriver...\n"
        )
        try:
            return ChromeSpeechRecognizer()
        except Exception as chrome_err:
            raise RuntimeError(
                f"All STT systems failed: "
                f"SpeechRecognition ({native_err}) | Chrome ({chrome_err})"
            )


_GLOBAL_RECOGNIZER = None


def SpeechRecognition() -> str:
    global _GLOBAL_RECOGNIZER
    if _GLOBAL_RECOGNIZER is None:
        _GLOBAL_RECOGNIZER = get_recognizer()
    return _GLOBAL_RECOGNIZER.listen_once()


if __name__ == "__main__":
    try:
        recognizer = get_recognizer()
        sys.stderr.write(f"STT Engine: {type(recognizer).__name__}\n")
        while True:
            text = recognizer.listen_once(timeout_sec=10.0)
            if text:
                print(text, flush=True)
            time.sleep(0.05)
    except KeyboardInterrupt:
        pass
    except Exception as exc:
        sys.stderr.write(f"STT Fatal Error: {exc}\n")
        sys.exit(1)
