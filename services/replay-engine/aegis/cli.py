"""AEGIS command line: receipt verification, the attack lab and the offline benchmark.

    python -m aegis.cli verify --receipt examples/receipts/blocked.json [--network]
    python -m aegis.cli verify-all
    python -m aegis.cli lab [--scenario 02]
    python -m aegis.cli benchmark [--output artifacts/benchmark-offline.json]
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

from . import fixtures, lab
from .receipts import export_evidence, verify_receipt

ROOT = fixtures.ROOT


def emit(data) -> None:
    print(json.dumps(data, indent=2, ensure_ascii=False))


def cmd_verify(args) -> int:
    receipt = json.loads(Path(args.receipt).read_text(encoding="utf-8"))
    if args.network:
        from .chain import verify_onchain
        result = verify_onchain(receipt)
    else:
        result = verify_receipt(receipt)
    emit(result)
    failed = bool(result["errors"]) or (args.network and result.get("on_chain") != "ON-CHAIN OUTCOME VERIFIED")
    return 1 if failed else 0


def cmd_verify_all(_args) -> int:
    files = sorted((ROOT / "examples/receipts").glob("*.json"))
    if not files:
        print("No example receipts. Run `pnpm demo:offline` first.", file=sys.stderr)
        return 1
    results = []
    for file in files:
        r = verify_receipt(json.loads(file.read_text(encoding="utf-8")))
        results.append({"file": file.name, "integrity": r["integrity"], "policy": r["policy"], "decision": r["decision"],
                        "ai_analysis": r["ai_analysis"], "errors": r["errors"]})
    emit(results)
    return 1 if any(r["errors"] for r in results) else 0


def cmd_lab(args) -> int:
    ids = [args.scenario] if args.scenario else [d["id"] for d in fixtures.scenarios()]
    rows = []
    for sid in ids:
        r = lab.run_scenario(sid, args.model)
        rows.append({"id": r["scenario"]["id"], "title": r["scenario"]["title"], "decision": r["decision"], "outcome": r["outcome"],
                     "matches_expected": r["matches_expected"], "blocked_by": r["observed_invariants"], "receipt": r["verification"]["integrity"]})
    emit(rows)
    return 0 if all(row["matches_expected"] for row in rows) else 1


def cmd_benchmark(args) -> int:
    started = time.perf_counter()
    result = lab.benchmark(args.model)
    verify_started = time.perf_counter()
    checks = [verify_receipt(run["receipt"]) for run in result["runs"]]
    result["average_receipt_verification_ms"] = round((time.perf_counter() - verify_started) * 1000 / len(checks), 3)
    result["total_wall_ms"] = round((time.perf_counter() - started) * 1000, 3)
    result["measured_at_utc"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    result["python"] = sys.version.split()[0]
    target = ROOT / args.output if not Path(args.output).is_absolute() else Path(args.output)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(result, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    runs = {r["scenario"]["id"]: r for r in result["runs"]}
    export_evidence(runs["01"]["receipt"], ROOT / "examples/receipts/allowed.json")
    export_evidence(runs["02"]["receipt"], ROOT / "examples/receipts/blocked.json")
    export_evidence(runs["05"]["receipt"], ROOT / "examples/receipts/tool-poisoning-blocked.json")
    summary = {k: v for k, v in result.items() if k != "runs"}
    summary["per_scenario"] = [{"id": r["scenario"]["id"], "title": r["scenario"]["title"], "decision": r["decision"], "outcome": r["outcome"],
                                "matches_expected": r["matches_expected"], "evaluation_ms": r["metrics"]["evaluation_ms"]} for r in result["runs"]]
    emit(summary)
    ok = result["unexpected_approvals"] == 0 and result["unexpected_rejections"] == 0 and result["matches_expected"] == result["total"] \
        and result["receipts_integrity_verified"] == result["total"]
    return 0 if ok else 1


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="aegis", description="AEGIS // Counterfactual evidence tools")
    sub = parser.add_subparsers(dest="command", required=True)
    verify = sub.add_parser("verify", help="Recompute a receipt's hashes, bindings and policy verdict")
    verify.add_argument("--receipt", required=True)
    verify.add_argument("--network", action="store_true", help="Also confirm the attestation and lifecycle state on NEAR testnet")
    sub.add_parser("verify-all", help="Verify every receipt in examples/receipts")
    lab_cmd = sub.add_parser("lab", help="Run attack-lab scenarios")
    lab_cmd.add_argument("--scenario")
    lab_cmd.add_argument("--model", action="store_true", help="Use the configured LLM (fails closed if unavailable)")
    bench = sub.add_parser("benchmark", help="Run every scenario and write raw JSON results")
    bench.add_argument("--output", default="artifacts/benchmark-offline.json")
    bench.add_argument("--model", action="store_true")
    args = parser.parse_args(argv)
    handlers = {"verify": cmd_verify, "verify-all": cmd_verify_all, "lab": cmd_lab, "benchmark": cmd_benchmark}
    try:
        return handlers[args.command](args)
    except (OSError, ValueError, KeyError) as exc:
        emit({"error": str(exc)[:500], "decision": "BLOCK"})
        return 1


if __name__ == "__main__":
    sys.exit(main())
