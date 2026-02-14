#!/usr/bin/env python3
"""
Ingest German federal case law from Rechtsprechung im Internet into SQLite.

Data source:
  - https://www.rechtsprechung-im-internet.de/rii-toc.xml
  - Per-case ZIP/XML links listed in the TOC
"""

from __future__ import annotations

import argparse
import datetime as dt
import io
import json
import re
import sqlite3
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from dataclasses import dataclass
from typing import Iterable
from xml.etree import ElementTree as ET

DEFAULT_TOC_URL = "https://www.rechtsprechung-im-internet.de/rii-toc.xml"
DEFAULT_DB_PATH = "data/database.db"
DEFAULT_TIMEOUT = 60
DEFAULT_RETRIES = 3
DEFAULT_SLEEP_SECONDS = 0.0
USER_AGENT = "ansvar-german-law-mcp/0.1"
NO_PROXY_OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))
WHITESPACE_PATTERN = re.compile(r"\s+")

SCHEMA_SQL = """
PRAGMA journal_mode = DELETE;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS case_law_documents (
  id TEXT PRIMARY KEY,
  country TEXT NOT NULL,
  case_id TEXT NOT NULL UNIQUE,
  ecli TEXT,
  court TEXT,
  decision_date TEXT,
  file_number TEXT,
  decision_type TEXT,
  title TEXT NOT NULL,
  citation TEXT,
  source_url TEXT NOT NULL,
  text_snippet TEXT,
  metadata_json TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_case_law_case_id ON case_law_documents(case_id);
CREATE INDEX IF NOT EXISTS idx_case_law_ecli ON case_law_documents(ecli);
CREATE INDEX IF NOT EXISTS idx_case_law_court ON case_law_documents(court);
CREATE INDEX IF NOT EXISTS idx_case_law_decision_date ON case_law_documents(decision_date);

CREATE VIRTUAL TABLE IF NOT EXISTS case_law_documents_fts USING fts5(
  title,
  citation,
  text_snippet,
  content='case_law_documents',
  content_rowid='rowid',
  tokenize='unicode61'
);

CREATE TRIGGER IF NOT EXISTS case_law_documents_ai
AFTER INSERT ON case_law_documents
BEGIN
  INSERT INTO case_law_documents_fts(rowid, title, citation, text_snippet)
  VALUES (new.rowid, new.title, COALESCE(new.citation, ''), COALESCE(new.text_snippet, ''));
END;

CREATE TRIGGER IF NOT EXISTS case_law_documents_ad
AFTER DELETE ON case_law_documents
BEGIN
  INSERT INTO case_law_documents_fts(case_law_documents_fts, rowid, title, citation, text_snippet)
  VALUES ('delete', old.rowid, old.title, COALESCE(old.citation, ''), COALESCE(old.text_snippet, ''));
END;

CREATE TRIGGER IF NOT EXISTS case_law_documents_au
AFTER UPDATE ON case_law_documents
BEGIN
  INSERT INTO case_law_documents_fts(case_law_documents_fts, rowid, title, citation, text_snippet)
  VALUES ('delete', old.rowid, old.title, COALESCE(old.citation, ''), COALESCE(old.text_snippet, ''));
  INSERT INTO case_law_documents_fts(rowid, title, citation, text_snippet)
  VALUES (new.rowid, new.title, COALESCE(new.citation, ''), COALESCE(new.text_snippet, ''));
END;

CREATE TABLE IF NOT EXISTS ingestion_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL,
  total_laws INTEGER NOT NULL DEFAULT 0,
  ingested_laws INTEGER NOT NULL DEFAULT 0,
  skipped_laws INTEGER NOT NULL DEFAULT 0,
  ingested_sections INTEGER NOT NULL DEFAULT 0,
  skipped_sections INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  error_sample TEXT,
  notes TEXT
);
"""


@dataclass(frozen=True)
class TocItem:
  case_id: str
  court: str
  decision_date: str
  file_number: str
  zip_url: str
  modified: str


@dataclass
class ParsedCase:
  case_id: str
  ecli: str | None
  court: str | None
  decision_date: str | None
  file_number: str | None
  decision_type: str | None
  title: str
  citation: str | None
  source_url: str
  text_snippet: str
  metadata_json: str


def now_iso() -> str:
  return dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z")


def collapse_whitespace(value: str | None) -> str:
  if not value:
    return ""
  return WHITESPACE_PATTERN.sub(" ", value).strip()


def normalize_zip_url(raw_url: str) -> str:
  parsed = urllib.parse.urlparse(raw_url.strip())
  path = parsed.path
  if not path:
    raise ValueError(f"Invalid ZIP URL in TOC: {raw_url}")
  return urllib.parse.urlunparse(("https", "www.rechtsprechung-im-internet.de", path, "", "", ""))


def extract_case_id(raw_url: str) -> str:
  parsed = urllib.parse.urlparse(raw_url.strip())
  path = parsed.path
  filename = path.split("/")[-1]
  filename = filename.replace(".zip", "").replace(".ZIP", "")
  if filename.lower().startswith("jb-"):
    filename = filename[3:]
  return filename.upper()


def normalize_decision_date(raw_value: str | None) -> str | None:
  value = collapse_whitespace(raw_value)
  if not value:
    return None
  if re.fullmatch(r"\d{8}", value):
    return f"{value[0:4]}-{value[4:6]}-{value[6:8]}"
  if re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
    return value
  return None


def http_get(url: str, timeout: int, retries: int) -> bytes:
  request = urllib.request.Request(
    url,
    headers={
      "User-Agent": USER_AGENT,
      "Accept": "*/*",
    },
  )

  attempt = 0
  while True:
    attempt += 1
    try:
      with NO_PROXY_OPENER.open(request, timeout=timeout) as response:
        return response.read()
    except (urllib.error.URLError, TimeoutError) as error:
      if attempt >= retries:
        raise RuntimeError(f"HTTP GET failed after {retries} attempts for {url}: {error}") from error
      time.sleep(min(2**attempt, 8))


def parse_toc(xml_payload: bytes) -> list[TocItem]:
  root = ET.fromstring(xml_payload)
  items: list[TocItem] = []

  for item in root.findall("./item"):
    link = collapse_whitespace(item.findtext("link"))
    if not link:
      continue
    case_id = extract_case_id(link)
    if not case_id:
      continue

    court = collapse_whitespace(item.findtext("gericht"))
    decision_date = collapse_whitespace(item.findtext("entsch-datum"))
    file_number = collapse_whitespace(item.findtext("aktenzeichen"))
    modified = collapse_whitespace(item.findtext("modified"))

    items.append(
      TocItem(
        case_id=case_id,
        court=court,
        decision_date=decision_date,
        file_number=file_number,
        zip_url=normalize_zip_url(link),
        modified=modified,
      )
    )

  return items


def xml_text(root: ET.Element, tag: str) -> str:
  node = root.find(tag)
  if node is None:
    return ""
  return collapse_whitespace(" ".join(part for part in node.itertext()))


def build_case_title(
  titelzeile: str,
  leitsatz: str,
  court: str | None,
  decision_date: str | None,
  file_number: str | None,
) -> str:
  if titelzeile:
    return titelzeile
  if leitsatz:
    return leitsatz[:280]
  chunks = [chunk for chunk in [court, decision_date, file_number] if chunk]
  if chunks:
    return " ".join(chunks)
  return "Gerichtsentscheidung"


def build_text_snippet(
  leitsatz: str,
  tenor: str,
  gruende: str,
  tatbestand: str,
  norm: str,
) -> str:
  parts = [part for part in [leitsatz, tenor, gruende, tatbestand, norm] if part]
  merged = collapse_whitespace(" ".join(parts))
  if len(merged) > 24000:
    return merged[:24000]
  return merged


def parse_case_package(item: TocItem, zip_payload: bytes) -> ParsedCase:
  with zipfile.ZipFile(io.BytesIO(zip_payload), "r") as archive:
    xml_members = [name for name in archive.namelist() if name.lower().endswith(".xml")]
    if not xml_members:
      raise RuntimeError(f"No XML file found in archive for {item.case_id}")
    xml_payload = archive.read(xml_members[0])

  root = ET.fromstring(xml_payload)
  doknr = xml_text(root, "doknr") or item.case_id
  ecli = xml_text(root, "ecli") or None
  court_type = xml_text(root, "gertyp")
  chamber = xml_text(root, "spruchkoerper")
  court = collapse_whitespace(" ".join(part for part in [court_type, chamber] if part)) or None
  decision_date = normalize_decision_date(xml_text(root, "entsch-datum") or item.decision_date)
  file_number = xml_text(root, "aktenzeichen") or item.file_number or None
  decision_type = xml_text(root, "doktyp") or None
  norm = xml_text(root, "norm")
  titelzeile = xml_text(root, "titelzeile")
  leitsatz = xml_text(root, "leitsatz")
  tenor = xml_text(root, "tenor")
  gruende = xml_text(root, "gruende") or xml_text(root, "entscheidungsgruende")
  tatbestand = xml_text(root, "tatbestand")

  title = build_case_title(titelzeile, leitsatz, court, decision_date, file_number)
  snippet = build_text_snippet(leitsatz, tenor, gruende, tatbestand, norm)
  citation = ecli or file_number or None
  source_url = item.zip_url

  metadata_payload = {
    "source": "rechtsprechung-im-internet",
    "case_id": doknr,
    "toc_case_id": item.case_id,
    "ecli": ecli,
    "court_toc": item.court or None,
    "court_xml": court,
    "decision_date_toc": normalize_decision_date(item.decision_date),
    "decision_date_xml": decision_date,
    "file_number_toc": item.file_number or None,
    "file_number_xml": file_number,
    "decision_type": decision_type,
    "norm": norm or None,
    "zip_url": item.zip_url,
    "modified": item.modified or None,
  }
  metadata_compact = {key: value for key, value in metadata_payload.items() if value not in (None, "")}

  return ParsedCase(
    case_id=doknr,
    ecli=ecli,
    court=court or item.court or None,
    decision_date=decision_date,
    file_number=file_number,
    decision_type=decision_type,
    title=title,
    citation=citation,
    source_url=source_url,
    text_snippet=snippet,
    metadata_json=json.dumps(metadata_compact, ensure_ascii=False),
  )


def ensure_schema(connection: sqlite3.Connection) -> None:
  connection.executescript(SCHEMA_SQL)


def insert_ingestion_run_start(connection: sqlite3.Connection, source_id: str, started_at: str, total_cases: int) -> int:
  cursor = connection.execute(
    """
    INSERT INTO ingestion_runs (source_id, started_at, status, total_laws)
    VALUES (?, ?, 'running', ?)
    """,
    (source_id, started_at, total_cases),
  )
  return int(cursor.lastrowid)


def finalize_ingestion_run(
  connection: sqlite3.Connection,
  run_id: int,
  *,
  finished_at: str,
  status: str,
  ingested_cases: int,
  skipped_cases: int,
  error_count: int,
  error_sample: list[str],
  notes: str | None = None,
) -> None:
  connection.execute(
    """
    UPDATE ingestion_runs
    SET finished_at = ?,
        status = ?,
        ingested_laws = ?,
        skipped_laws = ?,
        ingested_sections = ?,
        skipped_sections = ?,
        error_count = ?,
        error_sample = ?,
        notes = ?
    WHERE id = ?
    """,
    (
      finished_at,
      status,
      ingested_cases,
      skipped_cases,
      ingested_cases,
      skipped_cases,
      error_count,
      json.dumps(error_sample[:20], ensure_ascii=False) if error_sample else None,
      notes,
      run_id,
    ),
  )


def case_exists(connection: sqlite3.Connection, case_id: str) -> bool:
  row = connection.execute(
    "SELECT 1 FROM case_law_documents WHERE case_id = ? LIMIT 1",
    (case_id,),
  ).fetchone()
  return bool(row)


def upsert_case(connection: sqlite3.Connection, case: ParsedCase) -> None:
  now = now_iso()
  with connection:
    connection.execute(
      """
      INSERT INTO case_law_documents (
        id, country, case_id, ecli, court, decision_date, file_number, decision_type, title, citation, source_url, text_snippet, metadata_json, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        country = excluded.country,
        case_id = excluded.case_id,
        ecli = excluded.ecli,
        court = excluded.court,
        decision_date = excluded.decision_date,
        file_number = excluded.file_number,
        decision_type = excluded.decision_type,
        title = excluded.title,
        citation = excluded.citation,
        source_url = excluded.source_url,
        text_snippet = excluded.text_snippet,
        metadata_json = excluded.metadata_json,
        updated_at = excluded.updated_at
      """,
      (
        f"case:{case.case_id.lower()}",
        "de",
        case.case_id,
        case.ecli,
        case.court,
        case.decision_date,
        case.file_number,
        case.decision_type,
        case.title,
        case.citation,
        case.source_url,
        case.text_snippet,
        case.metadata_json,
        now,
      ),
    )


def parse_args(argv: list[str]) -> argparse.Namespace:
  parser = argparse.ArgumentParser(description="Ingest Rechtsprechung im Internet ZIP/XML packages into SQLite.")
  parser.add_argument("--db-path", default=DEFAULT_DB_PATH, help=f"SQLite path (default: {DEFAULT_DB_PATH})")
  parser.add_argument("--toc-url", default=DEFAULT_TOC_URL, help=f"TOC XML URL (default: {DEFAULT_TOC_URL})")
  parser.add_argument("--max-cases", type=int, default=None, help="Maximum number of cases to ingest")
  parser.add_argument("--offset", type=int, default=0, help="Skip first N TOC entries")
  parser.add_argument(
    "--order",
    choices=["latest", "toc"],
    default="latest",
    help="Order before offset/max filtering (default: latest).",
  )
  parser.add_argument("--case-id", action="append", default=[], help="Only ingest selected case id(s), repeatable")
  parser.add_argument("--court-contains", default=None, help="Only ingest cases where the court contains this string")
  parser.add_argument("--only-missing", action="store_true", help="Only ingest cases not yet present in case_law_documents")
  parser.add_argument("--refresh-existing", action="store_true", help="Re-ingest cases already present in the database")
  parser.add_argument(
    "--stop-after-existing",
    type=int,
    default=None,
    help="Stop after N consecutive already-known case IDs (for fast incremental updates).",
  )
  parser.add_argument("--sleep-seconds", type=float, default=DEFAULT_SLEEP_SECONDS, help="Pause between case downloads")
  parser.add_argument("--timeout", type=int, default=DEFAULT_TIMEOUT, help=f"HTTP timeout in seconds (default: {DEFAULT_TIMEOUT})")
  parser.add_argument("--retries", type=int, default=DEFAULT_RETRIES, help=f"HTTP retries (default: {DEFAULT_RETRIES})")
  parser.add_argument("--quiet", action="store_true", help="Suppress per-case progress logs")
  parser.add_argument("--dry-run", action="store_true", help="Resolve and report ingestion scope only")
  parser.add_argument("--report-path", default=None, help="Optional path to write summary JSON")
  return parser.parse_args(argv)


def filter_items(items: Iterable[TocItem], args: argparse.Namespace) -> list[TocItem]:
  filtered = list(items)

  if args.order == "latest":
    filtered = sorted(
      filtered,
      key=lambda item: (
        collapse_whitespace(item.modified),
        collapse_whitespace(item.decision_date),
        item.case_id,
      ),
      reverse=True,
    )

  if args.case_id:
    selected = {value.strip().upper() for value in args.case_id if value.strip()}
    filtered = [item for item in filtered if item.case_id.upper() in selected]

  if args.court_contains:
    needle = args.court_contains.lower()
    filtered = [item for item in filtered if needle in item.court.lower()]

  if args.offset > 0:
    filtered = filtered[args.offset :]

  if args.max_cases is not None and args.max_cases >= 0 and not args.only_missing:
    filtered = filtered[: args.max_cases]

  return filtered


def fetch_existing_case_ids(connection: sqlite3.Connection) -> set[str]:
  rows = connection.execute("SELECT case_id FROM case_law_documents").fetchall()
  return {str(row[0]).upper() for row in rows}


def run_ingestion(args: argparse.Namespace) -> dict[str, object]:
  started_at = now_iso()
  toc_payload = http_get(args.toc_url, timeout=args.timeout, retries=args.retries)
  toc_items = parse_toc(toc_payload)
  selected_items = filter_items(toc_items, args)

  if args.dry_run:
    existing_count = None
    missing_count = None
    if args.only_missing:
      connection = sqlite3.connect(args.db_path)
      ensure_schema(connection)
      existing_ids = fetch_existing_case_ids(connection)
      selected_items = [item for item in selected_items if item.case_id.upper() not in existing_ids]
      if args.max_cases is not None and args.max_cases >= 0:
        selected_items = selected_items[: args.max_cases]
      existing_count = len(existing_ids)
      missing_count = len(selected_items)
      connection.close()

    summary: dict[str, object] = {
      "started_at": started_at,
      "finished_at": now_iso(),
      "status": "dry_run",
      "source_id": "rechtsprechung-im-internet",
      "order": args.order,
      "toc_total_cases": len(toc_items),
      "selected_cases": len(selected_items),
      "sample_case_ids": [item.case_id for item in selected_items[:10]],
    }
    if existing_count is not None:
      summary["existing_cases"] = existing_count
    if missing_count is not None:
      summary["missing_cases"] = missing_count
    return summary

  connection = sqlite3.connect(args.db_path)
  connection.row_factory = sqlite3.Row
  ensure_schema(connection)
  if args.only_missing:
    existing_ids = fetch_existing_case_ids(connection)
    if args.stop_after_existing is None:
      selected_items = [item for item in selected_items if item.case_id.upper() not in existing_ids]
      if args.max_cases is not None and args.max_cases >= 0:
        selected_items = selected_items[: args.max_cases]
  else:
    existing_ids = set()

  connection.execute(
    """
    UPDATE ingestion_runs
    SET status = 'interrupted',
        finished_at = COALESCE(finished_at, ?),
        notes = COALESCE(notes, 'Run was interrupted before finalization.')
    WHERE status = 'running'
    """,
    (now_iso(),),
  )
  connection.commit()

  run_id = insert_ingestion_run_start(
    connection=connection,
    source_id="rechtsprechung-im-internet",
    started_at=started_at,
    total_cases=len(selected_items),
  )

  ingested_cases = 0
  skipped_cases = 0
  processed_cases = 0
  error_count = 0
  errors: list[str] = []
  consecutive_existing = 0
  stop_reason: str | None = None

  for index, item in enumerate(selected_items, start=1):
    try:
      if args.only_missing and item.case_id.upper() in existing_ids and not args.refresh_existing:
        skipped_cases += 1
        processed_cases += 1
        consecutive_existing += 1
        if not args.quiet:
          print(
            f"[skip] {index}/{len(selected_items)} {item.case_id} (already ingested)",
            file=sys.stderr,
          )
        if (
          args.stop_after_existing is not None
          and args.stop_after_existing >= 0
          and consecutive_existing >= args.stop_after_existing
        ):
          stop_reason = "consecutive_existing_threshold"
          break
        continue

      consecutive_existing = 0
      if args.max_cases is not None and args.max_cases >= 0 and ingested_cases >= args.max_cases:
        break

      if not args.quiet:
        print(
          f"[ingest] {index}/{len(selected_items)} {item.case_id} :: {item.court or '-'}",
          file=sys.stderr,
        )

      zip_payload = http_get(item.zip_url, timeout=args.timeout, retries=args.retries)
      parsed_case = parse_case_package(item, zip_payload)
      upsert_case(connection, parsed_case)
      ingested_cases += 1
      processed_cases += 1

      if args.sleep_seconds > 0:
        time.sleep(args.sleep_seconds)
    except Exception as error:  # noqa: BLE001
      error_count += 1
      processed_cases += 1
      message = f"{item.case_id}: {error}"
      errors.append(message)
      if not args.quiet:
        print(f"[error] {message}", file=sys.stderr)

  finished_at = now_iso()
  status = "success"
  if error_count > 0 and ingested_cases == 0:
    status = "failed"
  elif error_count > 0:
    status = "partial_success"

  finalize_ingestion_run(
    connection=connection,
    run_id=run_id,
    finished_at=finished_at,
    status=status,
    ingested_cases=ingested_cases,
    skipped_cases=skipped_cases,
    error_count=error_count,
    error_sample=errors,
  )
  connection.commit()
  connection.close()

  return {
    "started_at": started_at,
    "finished_at": finished_at,
    "status": status,
    "source_id": "rechtsprechung-im-internet",
    "order": args.order,
    "db_path": args.db_path,
    "toc_total_cases": len(toc_items),
    "selected_cases": processed_cases if not args.dry_run else len(selected_items),
    "existing_cases_before_run": len(existing_ids),
    "ingested_cases": ingested_cases,
    "skipped_cases": skipped_cases,
    "stop_reason": stop_reason,
    "error_count": error_count,
    "error_sample": errors[:10],
  }


def main(argv: list[str]) -> int:
  args = parse_args(argv)
  try:
    summary = run_ingestion(args)
  except Exception as error:  # noqa: BLE001
    failure_summary = {
      "started_at": now_iso(),
      "finished_at": now_iso(),
      "status": "failed",
      "source_id": "rechtsprechung-im-internet",
      "error": str(error),
    }
    print(json.dumps(failure_summary, ensure_ascii=False), file=sys.stdout)
    return 1

  output = json.dumps(summary, ensure_ascii=False)
  if args.report_path:
    with open(args.report_path, "w", encoding="utf-8") as handle:
      handle.write(output + "\n")
  print(output, file=sys.stdout)
  return 0


if __name__ == "__main__":
  raise SystemExit(main(sys.argv[1:]))
