#!/usr/bin/env python3
"""
Roady state governance guard.

Checks `.roady/plan.json` and `.roady/state.json` for:
- task IDs in state not present in plan
- IDs that only differ by Unicode dash variants / punctuation drift
- tasks marked in_progress that are missing from plan

Usage:
  python3 scripts/roady_state_guard.py
  python3 scripts/roady_state_guard.py --json
"""

from __future__ import annotations

import argparse
import json
import pathlib
import re
import sys
from dataclasses import dataclass
from typing import Dict, List, Tuple


ROOT = pathlib.Path(__file__).resolve().parents[1]
PLAN_PATH = ROOT / ".roady" / "plan.json"
STATE_PATH = ROOT / ".roady" / "state.json"


def normalize_task_id(task_id: str) -> str:
    """Normalize task IDs for fuzzy matching across dash variants.

    Keeps alnum/underscore/hyphen only, normalizes em/en/minus dashes to '-'.
    """
    s = task_id.strip().lower()
    s = s.replace("\u2014", "-").replace("\u2013", "-").replace("\u2212", "-")
    s = re.sub(r"[^a-z0-9_-]+", "-", s)
    s = re.sub(r"-+", "-", s).strip("-")
    return s


@dataclass
class GuardReport:
    missing_in_plan: List[str]
    fuzzy_matches: List[Tuple[str, str]]
    stale_in_progress: List[str]
    duplicate_normalized_plan_ids: Dict[str, List[str]]

    @property
    def ok(self) -> bool:
        # Legacy completed IDs may remain in state across plan generations.
        # Those are informational; we fail only on actionable drift.
        return (
            not self.fuzzy_matches
            and not self.stale_in_progress
            and not self.duplicate_normalized_plan_ids
        )


def load_json(path: pathlib.Path):
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def build_report() -> GuardReport:
    plan = load_json(PLAN_PATH)
    state = load_json(STATE_PATH)

    plan_ids: List[str] = [t["id"] for t in plan.get("tasks", []) if "id" in t]
    plan_id_set = set(plan_ids)

    normalized_plan: Dict[str, List[str]] = {}
    for pid in plan_ids:
        normalized_plan.setdefault(normalize_task_id(pid), []).append(pid)

    dup_norm = {k: v for k, v in normalized_plan.items() if len(v) > 1}

    state_task_states = state.get("task_states", {})
    state_ids = list(state_task_states.keys())

    missing_in_plan: List[str] = []
    fuzzy_matches: List[Tuple[str, str]] = []

    for sid in state_ids:
        if sid in plan_id_set:
            continue
        norm = normalize_task_id(sid)
        if norm in normalized_plan:
            fuzzy_matches.append((sid, normalized_plan[norm][0]))
        else:
            missing_in_plan.append(sid)

    stale_in_progress: List[str] = []
    for sid, meta in state_task_states.items():
        if meta.get("status") == "in_progress" and sid not in plan_id_set:
            stale_in_progress.append(sid)

    return GuardReport(
        missing_in_plan=sorted(missing_in_plan),
        fuzzy_matches=sorted(fuzzy_matches),
        stale_in_progress=sorted(stale_in_progress),
        duplicate_normalized_plan_ids=dup_norm,
    )


def print_human(report: GuardReport) -> None:
    if report.ok:
        print("OK: no Roady ID/state drift detected")
        return

    if report.duplicate_normalized_plan_ids:
        print("[ERROR] Duplicate normalized IDs in plan:")
        for norm, ids in report.duplicate_normalized_plan_ids.items():
            print(f"  - {norm}: {ids}")

    if report.fuzzy_matches:
        print("[WARN] State IDs that differ only by normalization:")
        for sid, pid in report.fuzzy_matches:
            print(f"  - state={sid!r} -> plan={pid!r}")

    if report.missing_in_plan:
        print("[WARN] State IDs missing from plan:")
        for sid in report.missing_in_plan:
            print(f"  - {sid}")

    if report.stale_in_progress:
        print("[WARN] Stale in_progress task IDs missing from plan:")
        for sid in report.stale_in_progress:
            print(f"  - {sid}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--json", action="store_true", help="emit JSON report")
    args = parser.parse_args()

    for path in (PLAN_PATH, STATE_PATH):
        if not path.exists():
            print(f"missing file: {path}", file=sys.stderr)
            return 2

    report = build_report()

    if args.json:
        print(
            json.dumps(
                {
                    "ok": report.ok,
                    "missing_in_plan": report.missing_in_plan,
                    "fuzzy_matches": report.fuzzy_matches,
                    "stale_in_progress": report.stale_in_progress,
                    "duplicate_normalized_plan_ids": report.duplicate_normalized_plan_ids,
                },
                indent=2,
                ensure_ascii=False,
            )
        )
    else:
        print_human(report)

    return 0 if report.ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
