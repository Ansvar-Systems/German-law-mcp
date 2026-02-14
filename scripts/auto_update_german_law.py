#!/usr/bin/env python3
"""
Run incremental auto-updates for German law sources.

This orchestrates:
  - Gesetze im Internet (statutes)
  - Rechtsprechung im Internet (case law)
  - DIP Bundestag (preparatory works)
"""

from __future__ import annotations

import argparse
import datetime as dt
import fcntl
import json
import os
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent

GESETZE_SCRIPT = SCRIPT_DIR / "ingest_gesetze_im_internet.py"
CASE_SCRIPT = SCRIPT_DIR / "ingest_rechtsprechung_im_internet.py"
DIP_SCRIPT = SCRIPT_DIR / "ingest_dip_bundestag.py"

DEFAULT_DB_PATH = str(PROJECT_ROOT / "data" / "database.db")
DEFAULT_LOCK_PATH = str(PROJECT_ROOT / "data" / ".auto_update.lock")


def now_iso() -> str:
  return dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z")


def parse_args(argv: list[str]) -> argparse.Namespace:
  parser = argparse.ArgumentParser(description="Incremental auto-update runner for German law MCP data.")
  parser.add_argument("--db-path", default=DEFAULT_DB_PATH, help=f"SQLite path (default: {DEFAULT_DB_PATH})")
  parser.add_argument("--lock-path", default=DEFAULT_LOCK_PATH, help=f"Lock file path (default: {DEFAULT_LOCK_PATH})")
  parser.add_argument("--dry-run", action="store_true", help="Run source ingestors in dry-run mode")

  parser.add_argument("--skip-statutes", action="store_true", help="Skip statutes source update")
  parser.add_argument("--skip-cases", action="store_true", help="Skip case-law source update")
  parser.add_argument("--skip-prep", action="store_true", help="Skip preparatory-works source update")

  default_cases_max = int(os.getenv("GERMAN_LAW_AUTO_UPDATE_CASES_MAX", "1000"))
  default_cases_stop = int(os.getenv("GERMAN_LAW_AUTO_UPDATE_CASES_STOP_AFTER_EXISTING", "500"))
  default_prep_max = int(os.getenv("GERMAN_LAW_AUTO_UPDATE_PREP_MAX", "5000"))
  default_prep_stop = int(os.getenv("GERMAN_LAW_AUTO_UPDATE_PREP_STOP_AFTER_EXISTING", "800"))

  parser.add_argument("--cases-max", type=int, default=default_cases_max, help="Max case-law decisions to ingest per cycle")
  parser.add_argument(
    "--cases-stop-after-existing",
    type=int,
    default=default_cases_stop,
    help="Stop case-law scan after N consecutive existing records",
  )
  parser.add_argument(
    "--prep-max",
    type=int,
    default=default_prep_max,
    help="Max preparatory-works records to ingest per cycle",
  )
  parser.add_argument(
    "--prep-stop-after-existing",
    type=int,
    default=default_prep_stop,
    help="Stop preparatory-works scan after N consecutive existing records",
  )
  parser.add_argument("--wahlperiode", action="append", default=[], help="DIP wahlperiode filter, repeatable")
  parser.add_argument("--api-key", default=None, help="Optional DIP API key override")
  parser.add_argument(
    "--source-retries",
    type=int,
    default=2,
    help="Retries per source when an ingestor run fails (default: 2)",
  )

  parser.add_argument(
    "--loop-minutes",
    type=float,
    default=None,
    help="Repeat update cycle every N minutes (omit for one-shot execution)",
  )
  parser.add_argument("--max-cycles", type=int, default=None, help="Optional max cycles when looping")
  parser.add_argument("--quiet", action="store_true", help="Suppress child ingestor logs")
  return parser.parse_args(argv)


def run_ingestor(
  name: str,
  script: Path,
  script_args: list[str],
  source_retries: int,
) -> dict[str, Any]:
  started_at = now_iso()
  attempt = 0
  retries = max(source_retries, 0)
  process: subprocess.CompletedProcess[str] | None = None
  report: dict[str, Any] = {}
  ok = False

  while attempt <= retries:
    attempt += 1
    process = subprocess.run(
      ["python3", str(script), *script_args],
      cwd=str(PROJECT_ROOT),
      capture_output=True,
      text=True,
    )

    stdout = process.stdout.strip()
    stderr = process.stderr.strip()
    report = {}
    if stdout:
      lines = [line.strip() for line in stdout.splitlines() if line.strip()]
      if lines:
        try:
          parsed = json.loads(lines[-1])
          if isinstance(parsed, dict):
            report = parsed
        except json.JSONDecodeError:
          report = {}

    ok = process.returncode == 0 and report.get("status") != "failed"
    if ok:
      break
    if attempt <= retries:
      time.sleep(min(2**attempt, 8))

  finished_at = now_iso()
  if process is None:
    process = subprocess.CompletedProcess(args=[], returncode=1, stdout="", stderr="")

  stderr = process.stderr.strip()
  if not report:
    report = {
      "status": "failed" if process.returncode != 0 else "unknown",
      "error": "No JSON report produced by ingestor.",
    }
    if stderr:
      report["stderr"] = stderr[-2000:]

  return {
    "source": name,
    "started_at": started_at,
    "finished_at": finished_at,
    "ok": ok,
    "exit_code": process.returncode,
    "attempts": attempt,
    "report": report,
  }


def extract_counts(report: dict[str, Any], dry_run: bool) -> tuple[int, int]:
  if dry_run:
    skipped = int(
      report.get("selected_laws")
      or report.get("selected_cases")
      or report.get("selected_documents")
      or 0
    )
    return (0, skipped)

  ingested = int(
    report.get("ingested_sections")
    or report.get("ingested_cases")
    or report.get("ingested_documents")
    or report.get("ingested_count")
    or 0
  )
  skipped = int(
    report.get("skipped_sections")
    or report.get("skipped_cases")
    or report.get("skipped_documents")
    or report.get("skipped_count")
    or 0
  )
  return (ingested, skipped)


def build_plan(args: argparse.Namespace) -> list[tuple[str, Path, list[str]]]:
  plan: list[tuple[str, Path, list[str]]] = []

  if not args.skip_statutes:
    statute_args = ["--db-path", args.db_path]
    if args.dry_run:
      statute_args += ["--dry-run", "--only-missing"]
    else:
      statute_args += ["--only-missing"]
      if args.quiet:
        statute_args.append("--quiet")
    plan.append(("gesetze-im-internet", GESETZE_SCRIPT, statute_args))

  if not args.skip_cases:
    case_args = [
      "--db-path",
      args.db_path,
      "--order",
      "latest",
      "--only-missing",
      "--max-cases",
      str(args.cases_max),
      "--stop-after-existing",
      str(args.cases_stop_after_existing),
    ]
    if args.dry_run:
      case_args.append("--dry-run")
    elif args.quiet:
      case_args.append("--quiet")
    plan.append(("rechtsprechung-im-internet", CASE_SCRIPT, case_args))

  if not args.skip_prep:
    prep_args = [
      "--db-path",
      args.db_path,
      "--only-missing",
      "--max-documents",
      str(args.prep_max),
      "--stop-after-existing",
      str(args.prep_stop_after_existing),
    ]
    if args.api_key:
      prep_args += ["--api-key", args.api_key]

    wahlperioden = [value.strip() for value in args.wahlperiode if value.strip()]
    if not wahlperioden:
      env_periods = os.getenv("GERMAN_LAW_PREP_WAHLPERIODEN", "").strip()
      if env_periods:
        wahlperioden = [value.strip() for value in env_periods.split(",") if value.strip()]
    if not wahlperioden:
      wahlperioden = ["20"]

    for period in wahlperioden:
      prep_args += ["--wahlperiode", period]

    if args.dry_run:
      prep_args.append("--dry-run")
    elif args.quiet:
      prep_args.append("--quiet")
    plan.append(("dip-bundestag", DIP_SCRIPT, prep_args))

  return plan


def run_cycle(args: argparse.Namespace, cycle_number: int) -> dict[str, Any]:
  started_at = now_iso()
  plan = build_plan(args)
  source_results: list[dict[str, Any]] = []
  total_ingested = 0
  total_skipped = 0
  failed_sources: list[str] = []

  for source_name, script_path, script_args in plan:
    result = run_ingestor(
      source_name,
      script_path,
      script_args,
      source_retries=args.source_retries,
    )
    source_results.append(result)

    ingested, skipped = extract_counts(result["report"], args.dry_run)
    total_ingested += ingested
    total_skipped += skipped

    if not result["ok"]:
      failed_sources.append(source_name)

  status = "success"
  if failed_sources and len(failed_sources) == len(source_results):
    status = "failed"
  elif failed_sources:
    status = "partial_success"

  return {
    "started_at": started_at,
    "finished_at": now_iso(),
    "cycle_number": cycle_number,
    "status": status,
    "dry_run": args.dry_run,
    "total_ingested": total_ingested,
    "total_skipped": total_skipped,
    "failed_sources": failed_sources,
    "source_results": source_results,
  }


def with_lock(lock_path: Path, run_fn) -> int:
  lock_path.parent.mkdir(parents=True, exist_ok=True)
  with open(lock_path, "w", encoding="utf-8") as handle:
    try:
      fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
      print(
        json.dumps(
          {
            "started_at": now_iso(),
            "finished_at": now_iso(),
            "status": "skipped_locked",
            "message": f"Another auto-update process holds lock: {lock_path}",
          },
          ensure_ascii=False,
        )
      )
      return 0

    return run_fn()


def main(argv: list[str]) -> int:
  args = parse_args(argv)
  lock_path = Path(args.lock_path).resolve()

  def execute() -> int:
    cycle = 0
    while True:
      cycle += 1
      summary = run_cycle(args, cycle_number=cycle)
      print(json.dumps(summary, ensure_ascii=False))

      if args.loop_minutes is None:
        break
      if args.max_cycles is not None and args.max_cycles >= 0 and cycle >= args.max_cycles:
        break
      if args.loop_minutes <= 0:
        break
      time.sleep(args.loop_minutes * 60.0)

    return 0

  return with_lock(lock_path, execute)


if __name__ == "__main__":
  raise SystemExit(main(sys.argv[1:]))
