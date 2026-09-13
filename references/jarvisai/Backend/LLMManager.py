"""Unified Multi-Provider LLM Client for JARVIS.

Features:
- Primary Google Gemini engine with multiple API key pool.
- Automatic key rotation on quota exhaustion (HTTP 429 / RESOURCE_EXHAUSTED).
- Seamless multi-provider fallback: Gemini -> OpenAI -> Claude -> DeepSeek -> Grok -> Groq -> Cohere.
- Zero uncaught quota errors; silent failover to the next healthy key/provider.
- Natural human-tone conversation format.
"""
from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import Any

import requests
from dotenv import dotenv_values

ROOT = Path(__file__).resolve().parent.parent
ENV_PATH = ROOT / ".env"


def _read_env() -> dict[str, str]:
    if ENV_PATH.exists():
        try:
            return {k: str(v) for k, v in dotenv_values(ENV_PATH).items() if v is not None}
        except Exception:
            return {}
    return {}


class LLMManager:
    def __init__(self) -> None:
        self.gemini_key_index = 0
        self._cached_keys: list[str] = []

    def get_gemini_keys(self) -> list[str]:
        """Collect all configured Gemini keys from environment or .env."""
        keys: list[str] = []
        env = _read_env()

        # Check explicit GEMINI_API_KEY / GeminiAPIKey / GeminiAPIKeys
        for name in ["GeminiAPIKeys", "GeminiAPIKey", "GEMINI_API_KEY"]:
            val = os.environ.get(name) or env.get(name) or ""
            if val:
                for chunk in re.split(r"[,;\n\r]+", val):
                    cleaned = chunk.strip().strip("'\"")
                    if cleaned and cleaned not in keys:
                        keys.append(cleaned)

        # Check indexed keys like GEMINI_API_KEY_1, GEMINI_API_KEY_2, etc.
        for i in range(1, 15):
            for pattern in [f"GEMINI_API_KEY_{i}", f"GeminiAPIKey_{i}"]:
                val = os.environ.get(pattern) or env.get(pattern) or ""
                cleaned = val.strip().strip("'\"")
                if cleaned and cleaned not in keys:
                    keys.append(cleaned)

        return keys

    def get_api_key(self, provider: str) -> str:
        env = _read_env()
        mapping = {
            "gemini": ["GeminiAPIKey", "GEMINI_API_KEY", "GeminiAPIKeys"],
            "openai": ["OpenAIAPIKey", "OPENAI_API_KEY"],
            "anthropic": ["AnthropicAPIKey", "ANTHROPIC_API_KEY", "ClaudeAPIKey"],
            "deepseek": ["DeepSeekAPIKey", "DEEPSEEK_API_KEY"],
            "xai": ["XaiAPIKey", "XAI_API_KEY", "GrokAPIKey"],
            "groq": ["GroqAPIKey", "GROQ_API_KEY"],
            "cohere": ["CohereAPIKey", "COHERE_API_KEY"],
        }
        for name in mapping.get(provider.lower(), []):
            val = os.environ.get(name) or env.get(name) or ""
            if val.strip():
                return val.strip().strip("'\"")
        return ""

    def _call_gemini(
        self,
        prompt: str,
        system_instruction: str = "",
        model: str = "gemini-3.8-flash",
        chat_history: list[dict[str, str]] | None = None,
    ) -> tuple[str, str]:
        keys = self.get_gemini_keys()
        if not keys:
            raise RuntimeError("No Gemini API keys configured")

        contents: list[dict[str, Any]] = []
        if chat_history:
            for item in chat_history[-10:]:
                role = "model" if item.get("role") in ["assistant", "model", "bot"] else "user"
                contents.append({"role": role, "parts": [{"text": str(item.get("content", ""))}]})

        contents.append({"role": "user", "parts": [{"text": prompt}]})

        total_keys = len(keys)
        errors: list[str] = []

        for attempt in range(total_keys):
            idx = (self.gemini_key_index + attempt) % total_keys
            key = keys[idx]

            candidate_models = [model, "gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.6-flash", "gemini-2.5-flash"]
            seen = set()
            ordered_models = [m for m in candidate_models if not (m in seen or seen.add(m))]

            for current_model in ordered_models:
                url = f"https://generativelanguage.googleapis.com/v1beta/models/{current_model}:generateContent?key={key}"
                body: dict[str, Any] = {
                    "contents": contents,
                    "generationConfig": {
                        "temperature": 0.7,
                        "maxOutputTokens": 4096,
                    },
                }
                if system_instruction:
                    body["systemInstruction"] = {"parts": [{"text": system_instruction}]}

                try:
                    res = requests.post(url, json=body, headers={"Content-Type": "application/json"}, timeout=45)
                    if res.status_code == 200:
                        data = res.json()
                        candidates = data.get("candidates") or []
                        if candidates:
                            parts = candidates[0].get("content", {}).get("parts", [])
                            text = "".join(p.get("text", "") for p in parts if p.get("text")).strip()
                            if text:
                                self.gemini_key_index = idx
                                return text, f"Gemini ({current_model} // Key #{idx+1})"
                    elif res.status_code in [404, 400] and "not found" in res.text.lower():
                        continue
                    elif res.status_code in [429, 403] or "quota" in res.text.lower() or "exhausted" in res.text.lower():
                        errors.append(f"Gemini Key #{idx+1} quota exceeded ({res.status_code})")
                        break
                    else:
                        errors.append(f"Gemini error ({res.status_code}): {res.text[:120]}")
                        break
                except Exception as exc:
                    errors.append(f"Gemini request exception: {exc}")
                    break

        raise RuntimeError(f"All Gemini keys exhausted: {' | '.join(errors)}")

    def _call_openai_compatible(
        self,
        base_url: str,
        api_key: str,
        model: str,
        prompt: str,
        system_instruction: str = "",
        provider_name: str = "OpenAI",
        chat_history: list[dict[str, str]] | None = None,
    ) -> tuple[str, str]:
        if not api_key:
            raise RuntimeError(f"{provider_name} API key not configured")

        messages: list[dict[str, str]] = []
        if system_instruction:
            messages.append({"role": "system", "content": system_instruction})
        if chat_history:
            for item in chat_history[-10:]:
                role = "assistant" if item.get("role") in ["assistant", "model", "bot"] else "user"
                messages.append({"role": role, "content": str(item.get("content", ""))})
        messages.append({"role": "user", "content": prompt})

        url = f"{base_url.rstrip('/')}/chat/completions"
        res = requests.post(
            url,
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json={"model": model, "messages": messages, "temperature": 0.7, "max_tokens": 2048},
            timeout=45,
        )
        if not res.ok:
            raise RuntimeError(f"{provider_name} returned {res.status_code}: {res.text[:150]}")
        data = res.json()
        text = data.get("choices", [{}])[0].get("message", {}).get("content", "").strip()
        if not text:
            raise RuntimeError(f"{provider_name} returned empty text")
        return text, f"{provider_name} ({model})"

    def _call_anthropic(
        self,
        api_key: str,
        model: str,
        prompt: str,
        system_instruction: str = "",
        chat_history: list[dict[str, str]] | None = None,
    ) -> tuple[str, str]:
        if not api_key:
            raise RuntimeError("Anthropic API key not configured")
        messages: list[dict[str, str]] = []
        if chat_history:
            for item in chat_history[-10:]:
                role = "assistant" if item.get("role") in ["assistant", "model", "bot"] else "user"
                messages.append({"role": role, "content": str(item.get("content", ""))})
        messages.append({"role": "user", "content": prompt})

        res = requests.post(
            "https://api.anthropic.com/v1/messages",
            headers={
                "x-api-key": api_key,
                "anthropic-version": "2023-06-01",
                "Content-Type": "application/json",
            },
            json={
                "model": model or "claude-3-5-haiku-latest",
                "max_tokens": 2048,
                "system": system_instruction,
                "messages": messages,
            },
            timeout=45,
        )
        if not res.ok:
            raise RuntimeError(f"Claude returned {res.status_code}: {res.text[:150]}")
        data = res.json()
        parts = data.get("content", [])
        text = "".join(p.get("text", "") for p in parts if p.get("text")).strip()
        return text, f"Claude ({model})"

    def _call_cohere(
        self,
        api_key: str,
        model: str,
        prompt: str,
        system_instruction: str = "",
        chat_history: list[dict[str, str]] | None = None,
    ) -> tuple[str, str]:
        if not api_key:
            raise RuntimeError("Cohere API key not configured")
        messages: list[dict[str, str]] = []
        if chat_history:
            for item in chat_history[-10:]:
                role = "assistant" if item.get("role") in ["assistant", "model", "bot"] else "user"
                messages.append({"role": role, "content": str(item.get("content", ""))})
        messages.append({"role": "user", "content": prompt})

        res = requests.post(
            "https://api.cohere.com/v2/chat",
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json={
                "model": model or "command-a-03-2025",
                "preamble": system_instruction,
                "messages": messages,
                "temperature": 0.7,
            },
            timeout=45,
        )
        if not res.ok:
            raise RuntimeError(f"Cohere returned {res.status_code}: {res.text[:150]}")
        data = res.json()
        parts = data.get("message", {}).get("content", [])
        text = "".join(p.get("text", "") for p in parts if p.get("text")).strip()
        return text, f"Cohere ({model})"

    def generate(
        self,
        prompt: str,
        system_instruction: str = "",
        preferred_provider: str | None = None,
        model: str | None = None,
        chat_history: list[dict[str, str]] | None = None,
    ) -> tuple[str, str]:
        """Generate response with primary Gemini (multi-key) and seamless failover."""
        attempts: list[str] = []

        providers_order = ["gemini", "openai", "anthropic", "deepseek", "xai", "groq", "cohere"]
        if preferred_provider and preferred_provider in providers_order:
            providers_order.remove(preferred_provider)
            providers_order.insert(0, preferred_provider)

        for provider in providers_order:
            try:
                res: tuple[str, str] | None = None
                if provider == "gemini":
                    target_model = model if (preferred_provider == "gemini" and model) else "gemini-3.8-flash"
                    res = self._call_gemini(
                        prompt=prompt,
                        system_instruction=system_instruction,
                        model=target_model,
                        chat_history=chat_history,
                    )
                elif provider == "openai":
                    key = self.get_api_key("openai")
                    target_model = model if (preferred_provider == "openai" and model) else "gpt-4o-mini"
                    res = self._call_openai_compatible(
                        "https://api.openai.com/v1", key, target_model, prompt, system_instruction, "ChatGPT", chat_history
                    )
                elif provider == "anthropic":
                    key = self.get_api_key("anthropic")
                    target_model = model if (preferred_provider == "anthropic" and model) else "claude-3-5-haiku-latest"
                    res = self._call_anthropic(key, target_model, prompt, system_instruction, chat_history)
                elif provider == "deepseek":
                    key = self.get_api_key("deepseek")
                    target_model = model if (preferred_provider == "deepseek" and model) else "deepseek-chat"
                    res = self._call_openai_compatible(
                        "https://api.deepseek.com/v1", key, target_model, prompt, system_instruction, "DeepSeek", chat_history
                    )
                elif provider == "xai":
                    key = self.get_api_key("xai")
                    target_model = model if (preferred_provider == "xai" and model) else "grok-3-mini"
                    res = self._call_openai_compatible(
                        "https://api.x.ai/v1", key, target_model, prompt, system_instruction, "Grok", chat_history
                    )
                elif provider == "groq":
                    key = self.get_api_key("groq")
                    target_model = model if (preferred_provider == "groq" and model) else "llama-3.3-70b-versatile"
                    res = self._call_openai_compatible(
                        "https://api.groq.com/openai/v1", key, target_model, prompt, system_instruction, "Groq", chat_history
                    )
                elif provider == "cohere":
                    key = self.get_api_key("cohere")
                    target_model = model if (preferred_provider == "cohere" and model) else "command-a-03-2025"
                    res = self._call_cohere(key, target_model, prompt, system_instruction, chat_history)
                if res:
                    self.last_provider_used = res[1]
                    return res
            except Exception as exc:
                attempts.append(f"{provider}: {exc}")
                continue

        fallback = (
            "All offline systems are operational. To enable generative AI reasoning and live answers, please configure an active API key (e.g. Google Gemini, Groq, or OpenAI) in Settings.",
            "JARVIS (Offline Fallback)",
        )
        self.last_provider_used = fallback[1]
        return fallback


LLM_CLIENT = LLMManager()
