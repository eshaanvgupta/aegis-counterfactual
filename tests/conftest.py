import copy
import json
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]


def load(name: str) -> dict:
    return json.loads((ROOT / "packages/shared-types" / name).read_text(encoding="utf-8"))


def merge(base: dict, patch: dict) -> dict:
    out = copy.deepcopy(base)
    for key, value in patch.items():
        if isinstance(value, dict) and isinstance(out.get(key), dict):
            out[key] = merge(out[key], value)
        else:
            out[key] = value
    return out


@pytest.fixture(autouse=True)
def isolated_runtime(tmp_path, monkeypatch):
    """Every test gets its own SQLite file and LOCAL_SIMULATION with no keys or model."""
    monkeypatch.setenv("AEGIS_DB", str(tmp_path / "aegis.sqlite3"))
    monkeypatch.setenv("AEGIS_MODE", "LOCAL_SIMULATION")
    monkeypatch.setenv("LLM_PROVIDER", "offline")
    for role in ("OWNER", "AGENT", "ATTESTOR", "VAULT"):
        monkeypatch.delenv(f"NEAR_{role}_PRIVATE_KEY", raising=False)
    yield
