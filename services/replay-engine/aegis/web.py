"""Shared HTTP hardening for the three services: correlation IDs, structured logs, body
limits, a browser-origin allowlist, a CSRF header for state-changing requests, simple
per-client rate limits, bearer-token checks in constant time, and fail-closed errors."""
from __future__ import annotations

import hmac
import json
import logging
import os
import threading
import time
import uuid
from collections import defaultdict, deque
from contextlib import asynccontextmanager
from typing import Callable

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .chain import ChainError
from .localvault import VaultError

LOG = logging.getLogger("aegis")
logging.basicConfig(level=logging.INFO, format="%(message)s")
ORIGINS = {"http://127.0.0.1:3000", "http://localhost:3000"} | {o for o in os.getenv("AEGIS_WEB_ORIGINS", "").split(",") if o}


def require_token(env_name: str, authorization: str | None) -> None:
    expected = os.getenv(env_name, "")
    supplied = authorization.removeprefix("Bearer ") if authorization and authorization.startswith("Bearer ") else ""
    if len(expected) < 24 or not hmac.compare_digest(expected.encode(), supplied.encode()):
        raise HTTPException(401, f"{env_name.removeprefix('AEGIS_').removesuffix('_TOKEN').title()} authentication required")


def create_app(title: str, service: str, rate_per_minute: int = 120, startup: Callable[[], None] | None = None) -> FastAPI:
    @asynccontextmanager
    async def lifespan(_app):
        if startup:
            startup()
        yield

    app = FastAPI(title=title, version="1.0.0", lifespan=lifespan)
    app.add_middleware(CORSMiddleware, allow_origins=sorted(ORIGINS), allow_methods=["GET", "POST"],
                       allow_headers=["Content-Type", "Authorization", "X-AEGIS-Client"])
    windows: dict[str, deque] = defaultdict(deque)
    lock = threading.Lock()

    @app.middleware("http")
    async def boundary(request: Request, call_next):
        correlation = request.headers.get("X-Correlation-ID") or str(uuid.uuid4())
        started = time.perf_counter()
        if request.method == "POST":
            body = await request.body()
            if len(body) > 512_000:
                return JSONResponse({"detail": "Request exceeds 512 KB"}, status_code=413)
            origin = request.headers.get("origin")
            if origin and origin not in ORIGINS:
                return JSONResponse({"detail": "Untrusted browser origin"}, status_code=403)
            if origin and request.headers.get("X-AEGIS-Client") != "workstation":
                return JSONResponse({"detail": "Missing X-AEGIS-Client header"}, status_code=403)
            key = request.client.host if request.client else "unknown"
            with lock:
                window = windows[key]
                now = time.monotonic()
                while window and now - window[0] > 60:
                    window.popleft()
                if len(window) >= rate_per_minute:
                    return JSONResponse({"detail": "Rate limit reached; retry in a minute"}, status_code=429)
                window.append(now)
        response = await call_next(request)
        response.headers["X-Correlation-ID"] = correlation
        LOG.info(json.dumps({"service": service, "correlation_id": correlation, "method": request.method, "path": request.url.path,
                             "status": response.status_code, "ms": round((time.perf_counter() - started) * 1000, 1)}))
        return response

    @app.exception_handler(VaultError)
    async def vault_error(_, exc: VaultError):
        return JSONResponse({"detail": exc.message, "codes": exc.codes}, status_code=409)

    @app.exception_handler(ChainError)
    async def chain_error(_, exc: ChainError):
        return JSONResponse({"detail": f"Testnet unavailable or rejected: {exc}"}, status_code=503)

    @app.exception_handler(PermissionError)
    async def permission_error(_, exc: PermissionError):
        return JSONResponse({"detail": str(exc)}, status_code=403)

    @app.exception_handler(ValueError)
    async def value_error(_, exc: ValueError):
        return JSONResponse({"detail": str(exc)[:500]}, status_code=400)

    @app.exception_handler(KeyError)
    async def key_error(_, exc: KeyError):
        return JSONResponse({"detail": f"Not found: {exc}"}, status_code=404)

    return app


def forbid_foreign_keys(own_role: str) -> None:
    """Refuse to start if this process received another principal's private key."""
    for other in ("OWNER", "AGENT", "ATTESTOR", "VAULT"):
        if other != own_role and os.getenv(f"NEAR_{other}_PRIVATE_KEY"):
            raise RuntimeError(f"The {own_role} service must not receive NEAR_{other}_PRIVATE_KEY")
