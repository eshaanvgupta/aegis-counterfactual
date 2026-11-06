"""Off-chain records in SQLite: lab runs, pipeline runs, receipts, agent observations,
authorized invoice texts and a structured service event log."""
from __future__ import annotations

import json
import sqlite3
import time
from contextlib import contextmanager

from .backend import db_path
from .canonical import fingerprint

SCHEMA = """
CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, scenario TEXT NOT NULL, created_at INTEGER NOT NULL, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS pipelines (id TEXT PRIMARY KEY, created_at INTEGER NOT NULL, intent_hash TEXT, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS receipts (intent_hash TEXT PRIMARY KEY, created_at INTEGER NOT NULL, receipt TEXT NOT NULL, verification TEXT, attestation TEXT);
CREATE TABLE IF NOT EXISTS observations (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at INTEGER NOT NULL, intent_hash TEXT, kind TEXT NOT NULL, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS invoices (fingerprint TEXT PRIMARY KEY, text TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, correlation_id TEXT, service TEXT, event TEXT NOT NULL, data TEXT NOT NULL);
"""


def now_ms() -> int:
    return int(time.time() * 1000)


@contextmanager
def connect():
    db = sqlite3.connect(db_path(), timeout=15)
    db.row_factory = sqlite3.Row
    try:
        db.executescript(SCHEMA)
        yield db
        db.commit()
    finally:
        db.close()


def put_run(run_id: str, scenario: str, data: dict) -> None:
    with connect() as db:
        db.execute("INSERT OR REPLACE INTO runs VALUES (?,?,?,?)", (run_id, scenario, now_ms(), json.dumps(data)))


def get_run(run_id: str) -> dict | None:
    with connect() as db:
        row = db.execute("SELECT data FROM runs WHERE id=?", (run_id,)).fetchone()
    return json.loads(row["data"]) if row else None


def list_runs(limit: int = 50) -> list[dict]:
    with connect() as db:
        rows = db.execute("SELECT data FROM runs ORDER BY created_at DESC LIMIT ?", (limit,)).fetchall()
    return [json.loads(r["data"]) for r in rows]


def put_pipeline(pipeline_id: str, data: dict) -> None:
    with connect() as db:
        db.execute("INSERT OR REPLACE INTO pipelines VALUES (?,?,?,?)", (pipeline_id, data.get("created_at_ms", now_ms()), data.get("intent_hash"), json.dumps(data)))


def get_pipeline(pipeline_id: str) -> dict | None:
    with connect() as db:
        row = db.execute("SELECT data FROM pipelines WHERE id=?", (pipeline_id,)).fetchone()
    return json.loads(row["data"]) if row else None


def list_pipelines(limit: int = 20) -> list[dict]:
    with connect() as db:
        rows = db.execute("SELECT data FROM pipelines ORDER BY created_at DESC LIMIT ?", (limit,)).fetchall()
    return [json.loads(r["data"]) for r in rows]


def put_receipt(intent_hash: str, receipt: dict, verification: dict | None = None, attestation: dict | None = None) -> None:
    with connect() as db:
        db.execute("INSERT OR REPLACE INTO receipts VALUES (?,?,?,?,?)",
                   (intent_hash, now_ms(), json.dumps(receipt), json.dumps(verification), json.dumps(attestation)))


def get_receipt(intent_hash: str) -> dict | None:
    with connect() as db:
        row = db.execute("SELECT * FROM receipts WHERE intent_hash=?", (intent_hash,)).fetchone()
    if not row:
        return None
    return {"receipt": json.loads(row["receipt"]), "verification": json.loads(row["verification"] or "null"),
            "attestation": json.loads(row["attestation"] or "null")}


def observe(kind: str, data: dict, intent_hash: str | None = None) -> None:
    with connect() as db:
        db.execute("INSERT INTO observations(created_at,intent_hash,kind,data) VALUES (?,?,?,?)", (now_ms(), intent_hash, kind, json.dumps(data)))


def observations(intent_hash: str) -> list[dict]:
    with connect() as db:
        rows = db.execute("SELECT kind,data,created_at FROM observations WHERE intent_hash=? ORDER BY id", (intent_hash,)).fetchall()
    return [{"kind": r["kind"], "created_at": r["created_at"], "data": json.loads(r["data"])} for r in rows]


def register_invoice(text: str) -> str:
    digest = fingerprint(text)
    with connect() as db:
        db.execute("INSERT OR IGNORE INTO invoices VALUES (?,?)", (digest, text))
    return digest


def invoice(digest: str) -> str | None:
    with connect() as db:
        row = db.execute("SELECT text FROM invoices WHERE fingerprint=?", (digest,)).fetchone()
    return row["text"] if row else None


def log_event(service: str, event: str, data: dict, correlation_id: str | None = None) -> None:
    with connect() as db:
        db.execute("INSERT INTO events(ts,correlation_id,service,event,data) VALUES (?,?,?,?,?)", (now_ms(), correlation_id, service, event, json.dumps(data)))


def recent_events(limit: int = 30) -> list[dict]:
    with connect() as db:
        rows = db.execute("SELECT * FROM events ORDER BY id DESC LIMIT ?", (limit,)).fetchall()
    return [dict(r) | {"data": json.loads(r["data"])} for r in rows]
