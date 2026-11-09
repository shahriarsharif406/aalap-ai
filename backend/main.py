"""Aalap backend.

Small FastAPI service that:
  * serves the static PWA from ../web
  * turns a photo / description of a place into a communication board (Gemini)
  * suggests phrase completions (Gemini)
  * provides a cloud text-to-speech fallback for languages that have no
    voice installed on the user's device (Gemini TTS)

Nothing the user uploads is stored or logged. If GEMINI_API_KEY is missing the
API reports ai=false and the app keeps working with its built-in boards.
"""
from __future__ import annotations

import asyncio
import base64
import logging
import io
import json
import os
import re
import time
import wave
from collections import defaultdict, deque
from pathlib import Path
from typing import Optional

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / "web"

GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta"
MODEL = os.getenv("GEMINI_MODEL", "gemini-3.8-flash")
TTS_MODEL = os.getenv("GEMINI_TTS_MODEL", "gemini-3.1-flash-tts-preview")
RATE_LIMIT = int(os.getenv("RATE_LIMIT_PER_HOUR", "40"))
MAX_IMAGE_B64 = 8 * 1024 * 1024  # ~6 MB binary

app = FastAPI(title="Aalap API", version="1.0.0", docs_url="/api/docs", openapi_url="/api/openapi.json")

_hits: dict[str, deque] = defaultdict(deque)


def api_key() -> Optional[str]:
    return os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY") or None


def rate_limit(request: Request) -> None:
    ip = (request.headers.get("x-forwarded-for") or (request.client.host if request.client else "?")).split(",")[0].strip()
    now = time.time()
    q = _hits[ip]
    while q and now - q[0] > 3600:
        q.popleft()
    if len(q) >= RATE_LIMIT:
        raise HTTPException(429, "Too many requests. Please try again later.")
    q.append(now)


def require_ai() -> str:
    key = api_key()
    if not key:
        raise HTTPException(503, "AI features are not configured on this server.")
    return key


FALLBACK_MODELS = ["gemini-3.6-flash", "gemini-3.5-flash", "gemini-flash-latest", "gemini-2.5-flash"]
FALLBACK_TTS = ["gemini-3.8-flash-tts", "gemini-2.5-flash-preview-tts"]


async def gemini(payload: dict, model: str, key: str) -> dict:
    """Call Gemini. Retries once on transient errors and falls back to other models if one is unavailable."""
    pool = FALLBACK_TTS if "tts" in model else FALLBACK_MODELS
    models = [model] + [m for m in pool if m != model]
    last = "AI service error."
    for m in models:
        url = f"{GEMINI_BASE}/models/{m}:generateContent"
        for attempt in range(2):
            try:
                async with httpx.AsyncClient(timeout=60) as client:
                    r = await client.post(url, headers={"x-goog-api-key": key, "Content-Type": "application/json"}, json=payload)
            except httpx.HTTPError:
                raise HTTPException(502, "Could not reach the AI service.")
            if r.status_code == 200:
                return r.json()
            try:
                msg = str(r.json().get("error", {}).get("message", ""))[:160]
            except Exception:
                msg = ""
            last = f"AI service error ({r.status_code}): {msg}".strip()
            logging.warning("gemini %s -> %s %s", m, r.status_code, msg)
            if r.status_code in (429, 500, 503) and attempt == 0:
                await asyncio.sleep(1.5)
                continue
            break
        if r.status_code not in (404, 400, 429, 503):
            break
    raise HTTPException(502, last)


def first_text(data: dict) -> str:
    try:
        return data["candidates"][0]["content"]["parts"][0]["text"]
    except (KeyError, IndexError, TypeError):
        raise HTTPException(502, "The AI returned an empty answer.")


def parse_json(text: str):
    text = text.strip()
    text = re.sub(r"^```(?:json)?|```$", "", text, flags=re.M).strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        raise HTTPException(502, "The AI returned an unreadable answer.")


def clean_items(items, limit: int) -> list[dict]:
    out, seen = [], set()
    for it in items if isinstance(items, list) else []:
        if not isinstance(it, dict):
            continue
        text = str(it.get("text", "")).strip()[:70]
        emoji = str(it.get("emoji", "")).strip()[:8] or "💬"
        if not text or text.lower() in seen:
            continue
        seen.add(text.lower())
        out.append({"emoji": emoji, "text": text})
        if len(out) >= limit:
            break
    return out


# ---------------------------------------------------------------- models
class BoardReq(BaseModel):
    image: Optional[str] = Field(None, description="base64 image without data: prefix")
    mime: str = "image/jpeg"
    text: Optional[str] = Field(None, max_length=400)
    lang: str = "en"
    lang_name: str = "English"
    modes: list[str] = []


class PhraseReq(BaseModel):
    context: str = Field("", max_length=300)
    lang: str = "en"
    lang_name: str = "English"


class TtsReq(BaseModel):
    text: str = Field(..., min_length=1, max_length=300)
    lang: str = "en"


# ---------------------------------------------------------------- routes
@app.get("/api/health")
async def health():
    return {"ok": True, "ai": bool(api_key()), "model": MODEL}


@app.post("/api/board")
async def board(req: BoardReq, request: Request):
    rate_limit(request)
    key = require_ai()
    if not req.image and not (req.text and req.text.strip()):
        raise HTTPException(422, "Send a photo or a short description of the place.")
    if req.image and len(req.image) > MAX_IMAGE_B64:
        raise HTTPException(413, "Image is too large.")
    if req.mime not in {"image/jpeg", "image/png", "image/webp"}:
        raise HTTPException(422, "Unsupported image type.")
    lang_name = re.sub(r"[^\w\s().-]", "", req.lang_name)[:30] or "English"

    simple = "intellect" in req.modes
    count = 8 if simple else 14
    style = (
        "Use only very simple, concrete words a young child with an intellectual disability can understand."
        if simple
        else "Use short, natural first-person phrases a child would really say."
    )
    prompt = (
        "You help non-speaking children with disabilities communicate (AAC). "
        "Look at the scene and create a communication board for exactly this place and moment. "
        f"Return {count} tiles. Each tile has one emoji and a short phrase (max 6 words) written in {lang_name}. "
        f"{style} Cover requests, objects that are actually visible, actions, feelings and one safety/help phrase. "
        "If the photo is unclear or shows nothing specific, make a useful general everyday board instead. "
        "Never include anything unsafe or inappropriate for children. Also return a short board title in the same language."
    )
    if req.text:
        prompt += f"\nCaregiver description of the place: {req.text.strip()}"

    parts: list[dict] = [{"text": prompt}]
    if req.image:
        try:
            base64.b64decode(req.image, validate=True)
        except Exception:
            raise HTTPException(422, "Image data is not valid base64.")
        parts.append({"inline_data": {"mime_type": req.mime, "data": req.image}})

    schema = {
        "type": "OBJECT",
        "properties": {
            "title": {"type": "STRING"},
            "items": {
                "type": "ARRAY",
                "items": {
                    "type": "OBJECT",
                    "properties": {"emoji": {"type": "STRING"}, "text": {"type": "STRING"}},
                    "required": ["emoji", "text"],
                },
            },
        },
        "required": ["title", "items"],
    }
    data = await gemini(
        {
            "contents": [{"parts": parts}],
            "generationConfig": {"responseMimeType": "application/json", "responseSchema": schema, "temperature": 0.4},
        },
        MODEL,
        key,
    )
    obj = parse_json(first_text(data))
    items = clean_items(obj.get("items") if isinstance(obj, dict) else None, count + 2)
    if len(items) < 3:
        raise HTTPException(502, "The AI could not build a board from this input. Try another photo.")
    title = str(obj.get("title", "")).strip()[:40] or items[0]["text"]
    return {"title": title, "items": items}


@app.post("/api/phrases")
async def phrases(req: PhraseReq, request: Request):
    rate_limit(request)
    key = require_ai()
    ctx = req.context.strip()
    if len(ctx) < 2:
        return {"phrases": []}
    lang_name = re.sub(r"[^\w\s().-]", "", req.lang_name)[:30] or "English"
    prompt = (
        f"A child who cannot speak is typing to communicate. They typed: \"{ctx}\".\n"
        f"Suggest 6 short, complete sentences in {lang_name} (max 8 words each) that they most likely want to say. "
        "Child-friendly and safe. Return JSON: {\"phrases\": [\"...\"]}."
    )
    data = await gemini(
        {
            "contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {
                "responseMimeType": "application/json",
                "responseSchema": {"type": "OBJECT", "properties": {"phrases": {"type": "ARRAY", "items": {"type": "STRING"}}}, "required": ["phrases"]},
                "temperature": 0.5,
            },
        },
        MODEL,
        key,
    )
    obj = parse_json(first_text(data))
    out = [str(p).strip()[:80] for p in (obj.get("phrases") if isinstance(obj, dict) else []) if str(p).strip()]
    return {"phrases": out[:6]}


@app.post("/api/tts")
async def tts(req: TtsReq, request: Request):
    """Cloud voice fallback for languages with no on-device voice."""
    rate_limit(request)
    key = require_ai()
    payload = {
        "contents": [{"parts": [{"text": req.text}]}],
        "generationConfig": {
            "responseModalities": ["AUDIO"],
            "speechConfig": {"voiceConfig": {"prebuiltVoiceConfig": {"voiceName": "Kore"}}},
        },
    }
    data = await gemini(payload, TTS_MODEL, key)
    try:
        pcm = base64.b64decode(data["candidates"][0]["content"]["parts"][0]["inlineData"]["data"])
    except (KeyError, IndexError, TypeError, ValueError):
        raise HTTPException(502, "Voice service returned no audio.")
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(24000)
        w.writeframes(pcm)
    return Response(buf.getvalue(), media_type="audio/wav", headers={"Cache-Control": "no-store"})


# Static PWA last so /api/* wins.
if WEB.exists():
    app.mount("/", StaticFiles(directory=str(WEB), html=True), name="web")
