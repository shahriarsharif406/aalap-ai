import base64
import os
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))
import main  # noqa: E402


@pytest.fixture(autouse=True)
def _reset(monkeypatch):
    main._hits.clear()
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("GOOGLE_API_KEY", raising=False)


client = TestClient(main.app)


def test_health_without_key():
    r = client.get("/api/health")
    assert r.status_code == 200 and r.json()["ai"] is False


def test_health_with_key(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "x")
    assert client.get("/api/health").json()["ai"] is True


def test_board_needs_ai():
    r = client.post("/api/board", json={"text": "kitchen table"})
    assert r.status_code == 503


def test_board_needs_input(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "x")
    assert client.post("/api/board", json={}).status_code == 422


def test_board_bad_base64(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "x")
    r = client.post("/api/board", json={"image": "not base64!!"})
    assert r.status_code == 422


def test_board_ok_with_mocked_gemini(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "x")

    async def fake(payload, model, key):
        assert "Bangla" in payload["contents"][0]["parts"][0]["text"]
        body = '{"title":"খাবার","items":[{"emoji":"🍚","text":"ভাত চাই"},{"emoji":"💧","text":"পানি চাই"},{"emoji":"✋","text":"থামো"},{"emoji":"🍚","text":"ভাত চাই"}]}'
        return {"candidates": [{"content": {"parts": [{"text": body}]}}]}

    monkeypatch.setattr(main, "gemini", fake)
    img = base64.b64encode(b"\xff\xd8\xff fake").decode()
    r = client.post("/api/board", json={"image": img, "lang": "bn", "lang_name": "Bangla"})
    assert r.status_code == 200
    data = r.json()
    assert data["title"] == "খাবার"
    assert len(data["items"]) == 3  # duplicate removed


def test_rate_limit(monkeypatch):
    monkeypatch.setattr(main, "RATE_LIMIT", 2)
    for _ in range(2):
        client.post("/api/board", json={"text": "x"})
    assert client.post("/api/board", json={"text": "x"}).status_code == 429


def test_landing_and_app_served():
    assert "Every child has" in client.get("/").text
    r = client.get("/app.html")
    assert r.status_code == 200 and 'id="app"' in r.text


def test_pictograms_and_manifest_served():
    assert client.get("/pict/1f35a.svg").status_code == 200
    m = client.get("/manifest.json").json()
    assert m["start_url"] == "app.html"


def test_gemini_falls_back_to_next_model(monkeypatch):
    import asyncio
    import backend.main as m

    calls = []

    class R:
        def __init__(self, code, body):
            self.status_code, self._b = code, body
        def json(self):
            return self._b

    class C:
        def __init__(self, *a, **k): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *a): return False
        async def post(self, url, **k):
            calls.append(url)
            if "gemini-3.8-flash:" in url:
                return R(404, {"error": {"message": "model not found"}})
            return R(200, {"ok": True})

    monkeypatch.setattr(m.httpx, "AsyncClient", C)
    out = asyncio.run(m.gemini({}, "gemini-3.8-flash", "k"))
    assert out == {"ok": True} and len(calls) == 2


def test_gemini_error_message_is_reported(monkeypatch):
    import asyncio
    import pytest
    import backend.main as m
    from fastapi import HTTPException

    class R:
        status_code = 403
        def json(self): return {"error": {"message": "API key not valid"}}

    class C:
        def __init__(self, *a, **k): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *a): return False
        async def post(self, url, **k): return R()

    monkeypatch.setattr(m.httpx, "AsyncClient", C)
    with pytest.raises(HTTPException) as e:
        asyncio.run(m.gemini({}, "gemini-3.8-flash", "k"))
    assert "403" in e.value.detail and "API key not valid" in e.value.detail
