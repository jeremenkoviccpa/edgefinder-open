"""Thin client for any OpenAI-compatible endpoint serving an open-weights model.

Local (free):   LLM_BASE_URL=http://localhost:11434/v1  LLM_MODEL=hermes3:8b  (Ollama)
Hosted (cheap): Groq / OpenRouter / DeepInfra / Together all expose the same API;
                set LLM_BASE_URL, LLM_API_KEY, LLM_MODEL to an open model they host.
"""
import json
import re

from openai import OpenAI

from .config import LLM_API_KEY, LLM_BASE_URL, LLM_MODEL, LLM_REASONING_EFFORT

_client: OpenAI | None = None


def client() -> OpenAI:
    global _client
    if _client is None:
        _client = OpenAI(base_url=LLM_BASE_URL, api_key=LLM_API_KEY, timeout=300)
    return _client


def _extract_json(text: str) -> dict:
    text = re.sub(r"<think>.*?</think>", "", text, flags=re.S)  # reasoning models
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        m = re.search(r"\{.*\}", text, re.S)
        if not m:
            raise
        return json.loads(m.group(0))


def chat_json(system: str, user: str, max_tokens: int = 1500, temperature: float = 0.2) -> dict:
    msgs = [{"role": "system", "content": system}, {"role": "user", "content": user}]
    kwargs = dict(model=LLM_MODEL, messages=msgs, max_tokens=max_tokens, temperature=temperature)
    if LLM_REASONING_EFFORT:
        kwargs["reasoning_effort"] = LLM_REASONING_EFFORT
    try:
        resp = client().chat.completions.create(response_format={"type": "json_object"}, **kwargs)
    except Exception:
        resp = client().chat.completions.create(**kwargs)  # provider without JSON mode
    return _extract_json(resp.choices[0].message.content or "{}")


def available() -> bool:
    try:
        client().models.list()
        return True
    except Exception:
        return False
