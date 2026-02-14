#!/usr/bin/env python3
"""
Ingest German preparatory works from DIP Bundestag API into SQLite.

Source:
  - https://search.dip.bundestag.de/api/v1/vorgang
"""

from __future__ import annotations

import argparse
import datetime as dt
import http.client
import json
import os
import re
import sqlite3
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

DEFAULT_API_URL = "https://search.dip.bundestag.de/api/v1/vorgang"
DEFAULT_CONFIG_URL = "https://dip.bundestag.de/dip-config.js"
DEFAULT_DB_PATH = "data/database.db"
DEFAULT_TIMEOUT = 60
DEFAULT_RETRIES = 3
DEFAULT_SLEEP_SECONDS = 0.05
DEFAULT_WAHLPERIODE = "20"
USER_AGENT = "ansvar-german-law-mcp/0.1"
NO_PROXY_OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))
WHITESPACE_PATTERN = re.compile(r"\s+")
UPPER_TOKEN_PATTERN = re.compile(r"\b[A-Z][A-Z0-9_-]{1,14}\b")
API_KEY_PATTERN = re.compile(r"portalApiKey\s*=\s*'([^']+)'")
DEFAULT_PUBLIC_API_KEY = "SbGXhWA.3cpnNdb8rkht7iWpvSgTP8XIG88LoCrGd4"

SCHEMA_SQL = """
PRAGMA journal_mode = DELETE;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS preparatory_works (
  id TEXT PRIMARY KEY,
  country TEXT NOT NULL,
  dip_id TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  statute_id TEXT,
  statute_citation TEXT,
  work_type TEXT,
  publication_date TEXT,
  source_url TEXT NOT NULL,
  text_snippet TEXT,
  metadata_json TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_prep_works_dip_id ON preparatory_works(dip_id);
CREATE INDEX IF NOT EXISTS idx_prep_works_statute_id ON preparatory_works(statute_id);
CREATE INDEX IF NOT EXISTS idx_prep_works_publication_date ON preparatory_works(publication_date);
CREATE INDEX IF NOT EXISTS idx_prep_works_work_type ON preparatory_works(work_type);

CREATE VIRTUAL TABLE IF NOT EXISTS preparatory_works_fts USING fts5(
  title,
  statute_citation,
  text_snippet,
  content='preparatory_works',
  content_rowid='rowid',
  tokenize='unicode61'
);

CREATE TRIGGER IF NOT EXISTS preparatory_works_ai
AFTER INSERT ON preparatory_works
BEGIN
  INSERT INTO preparatory_works_fts(rowid, title, statute_citation, text_snippet)
  VALUES (new.rowid, new.title, COALESCE(new.statute_citation, ''), COALESCE(new.text_snippet, ''));
END;

CREATE TRIGGER IF NOT EXISTS preparatory_works_ad
AFTER DELETE ON preparatory_works
BEGIN
  INSERT INTO preparatory_works_fts(preparatory_works_fts, rowid, title, statute_citation, text_snippet)
  VALUES ('delete', old.rowid, old.title, COALESCE(old.statute_citation, ''), COALESCE(old.text_snippet, ''));
END;

CREATE TRIGGER IF NOT EXISTS preparatory_works_au
AFTER UPDATE ON preparatory_works
BEGIN
  INSERT INTO preparatory_works_fts(preparatory_works_fts, rowid, title, statute_citation, text_snippet)
  VALUES ('delete', old.rowid, old.title, COALESCE(old.statute_citation, ''), COALESCE(old.text_snippet, ''));
  INSERT INTO preparatory_works_fts(rowid, title, statute_citation, text_snippet)
  VALUES (new.rowid, new.title, COALESCE(new.statute_citation, ''), COALESCE(new.text_snippet, ''));
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


def now_iso() -> str:
  return dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z")


def collapse_whitespace(value: str | None) -> str:
  if not value:
    return ""
  return WHITESPACE_PATTERN.sub(" ", value).strip()


def normalize_iso_date(value: str | None) -> str | None:
  text = collapse_whitespace(value)
  if not text:
    return None
  if re.fullmatch(r"\d{4}-\d{2}-\d{2}", text):
    return text
  if re.fullmatch(r"\d{8}", text):
    return f"{text[0:4]}-{text[4:6]}-{text[6:8]}"
  return None


def http_get(url: str, timeout: int, retries: int, headers: dict[str, str] | None = None) -> bytes:
  request = urllib.request.Request(
    url,
    headers={
      "User-Agent": USER_AGENT,
      "Accept": "application/json, text/plain, */*",
      **(headers or {}),
    },
  )

  attempt = 0
  while True:
    attempt += 1
    try:
      with NO_PROXY_OPENER.open(request, timeout=timeout) as response:
        return response.read()
    except (urllib.error.URLError, TimeoutError, http.client.IncompleteRead) as error:
      if attempt >= retries:
        raise RuntimeError(f"HTTP GET failed after {retries} attempts for {url}: {error}") from error
      time.sleep(min(2**attempt, 8))


def parse_json_response(payload: bytes, source: str) -> dict[str, Any]:
  try:
    parsed = json.loads(payload.decode("utf-8"))
  except json.JSONDecodeError as error:
    raise RuntimeError(f"Invalid JSON payload from {source}: {error}") from error
  if not isinstance(parsed, dict):
    raise RuntimeError(f"Unexpected response shape from {source}: expected object")
  return parsed


def resolve_api_key(args: argparse.Namespace) -> str:
  if args.api_key:
    return args.api_key

  env_key = os.getenv("GERMAN_LAW_DIP_API_KEY", "").strip()
  if env_key:
    return env_key

  try:
    config_payload = http_get(
      args.config_url,
      timeout=args.timeout,
      retries=args.retries,
      headers={"Accept": "text/javascript, application/javascript, */*"},
    )
    config_text = config_payload.decode("utf-8", errors="ignore")
    match = API_KEY_PATTERN.search(config_text)
    if match:
      return match.group(1)
  except Exception:  # noqa: BLE001
    pass

  return DEFAULT_PUBLIC_API_KEY


def build_search_url(
  base_url: str,
  api_key: str,
  *,
  cursor: str | None,
  query: str | None,
  wahlperioden: list[str],
  vorgangstyp: list[str],
) -> str:
  params: list[tuple[str, str]] = [("apikey", api_key)]
  if query:
    params.append(("q", query))
  for period in wahlperioden:
    params.append(("f.wahlperiode", period))
  for item in vorgangstyp:
    params.append(("f.vorgangstyp", item))
  if cursor:
    params.append(("cursor", cursor))
  query_string = urllib.parse.urlencode(params, doseq=True)
  return f"{base_url}?{query_string}"


def ensure_schema(connection: sqlite3.Connection) -> None:
  connection.executescript(SCHEMA_SQL)


def insert_ingestion_run_start(connection: sqlite3.Connection, source_id: str, started_at: str) -> int:
  cursor = connection.execute(
    """
    INSERT INTO ingestion_runs (source_id, started_at, status, total_laws)
    VALUES (?, ?, 'running', 0)
    """,
    (source_id, started_at),
  )
  return int(cursor.lastrowid)


def finalize_ingestion_run(
  connection: sqlite3.Connection,
  run_id: int,
  *,
  finished_at: str,
  status: str,
  total_documents: int,
  ingested_documents: int,
  skipped_documents: int,
  error_count: int,
  error_sample: list[str],
) -> None:
  connection.execute(
    """
    UPDATE ingestion_runs
    SET finished_at = ?,
        status = ?,
        total_laws = ?,
        ingested_laws = ?,
        skipped_laws = ?,
        ingested_sections = ?,
        skipped_sections = ?,
        error_count = ?,
        error_sample = ?
    WHERE id = ?
    """,
    (
      finished_at,
      status,
      total_documents,
      ingested_documents,
      skipped_documents,
      ingested_documents,
      skipped_documents,
      error_count,
      json.dumps(error_sample[:20], ensure_ascii=False) if error_sample else None,
      run_id,
    ),
  )


def fetch_existing_dip_ids(connection: sqlite3.Connection) -> set[str]:
  rows = connection.execute("SELECT dip_id FROM preparatory_works").fetchall()
  return {str(row[0]) for row in rows}


def load_statute_code_map(connection: sqlite3.Connection) -> dict[str, str]:
  if not table_exists(connection, "statutes"):
    return {}

  rows = connection.execute(
    """
    SELECT statute_id, jurabk, amtabk
    FROM statutes
    """
  ).fetchall()
  mapping: dict[str, str] = {}
  for statute_id, jurabk, amtabk in rows:
    for value in [jurabk, amtabk]:
      text = collapse_whitespace(value)
      if not text:
        continue
      token = text.upper()
      if token not in mapping:
        mapping[token] = str(statute_id)
  return mapping


def table_exists(connection: sqlite3.Connection, table_name: str) -> bool:
  row = connection.execute(
    """
    SELECT 1
    FROM sqlite_master
    WHERE type = 'table'
      AND name = ?
    LIMIT 1
    """,
    (table_name,),
  ).fetchone()
  return bool(row)


def extract_descriptor_names(document: dict[str, Any]) -> list[str]:
  descriptors = document.get("deskriptor")
  if not isinstance(descriptors, list):
    return []
  names: list[str] = []
  for item in descriptors:
    if not isinstance(item, dict):
      continue
    name = collapse_whitespace(str(item.get("name", "")))
    if name:
      names.append(name)
  return names


def extract_citation_candidates(document: dict[str, Any]) -> list[str]:
  candidates: list[str] = []
  descriptors = document.get("deskriptor")
  if isinstance(descriptors, list):
    for item in descriptors:
      if not isinstance(item, dict):
        continue
      if not item.get("fundstelle"):
        continue
      name = collapse_whitespace(str(item.get("name", "")))
      if name:
        candidates.append(name)

  publications = document.get("verkuendung")
  if isinstance(publications, list):
    for item in publications:
      if not isinstance(item, dict):
        continue
      for key in ["fundstelle", "einleitungstext"]:
        value = collapse_whitespace(str(item.get(key, "")))
        if value:
          candidates.append(value)

  return dedupe_strings(candidates)


def derive_statute_id(
  title: str,
  abstract: str,
  descriptors: list[str],
  citation_candidates: list[str],
  statute_code_map: dict[str, str],
) -> str | None:
  if not statute_code_map:
    return None

  haystack = " ".join([title, abstract, *descriptors, *citation_candidates]).upper()
  if not haystack:
    return None

  for token in UPPER_TOKEN_PATTERN.findall(haystack):
    statute_id = statute_code_map.get(token)
    if statute_id:
      return statute_id

  return None


def dedupe_strings(values: list[str]) -> list[str]:
  seen: set[str] = set()
  result: list[str] = []
  for value in values:
    if value not in seen:
      seen.add(value)
      result.append(value)
  return result


def build_text_snippet(
  title: str,
  abstract: str,
  descriptors: list[str],
  initiative: list[str],
  citations: list[str],
) -> str:
  parts = [title, abstract, " ".join(descriptors), " ".join(initiative), " ".join(citations)]
  merged = collapse_whitespace(" ".join(part for part in parts if part))
  if len(merged) > 24000:
    return merged[:24000]
  return merged


def upsert_preparatory_work(
  connection: sqlite3.Connection,
  *,
  dip_id: str,
  title: str,
  statute_id: str | None,
  statute_citation: str | None,
  work_type: str | None,
  publication_date: str | None,
  source_url: str,
  text_snippet: str,
  metadata_json: str,
) -> None:
  now = now_iso()
  with connection:
    connection.execute(
      """
      INSERT INTO preparatory_works (
        id, country, dip_id, title, statute_id, statute_citation, work_type, publication_date, source_url, text_snippet, metadata_json, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        country = excluded.country,
        dip_id = excluded.dip_id,
        title = excluded.title,
        statute_id = excluded.statute_id,
        statute_citation = excluded.statute_citation,
        work_type = excluded.work_type,
        publication_date = excluded.publication_date,
        source_url = excluded.source_url,
        text_snippet = excluded.text_snippet,
        metadata_json = excluded.metadata_json,
        updated_at = excluded.updated_at
      """,
      (
        f"prep:{dip_id}",
        "de",
        dip_id,
        title,
        statute_id,
        statute_citation,
        work_type,
        publication_date,
        source_url,
        text_snippet,
        metadata_json,
        now,
      ),
    )


def parse_args(argv: list[str]) -> argparse.Namespace:
  parser = argparse.ArgumentParser(description="Ingest preparatory works from DIP Bundestag API into SQLite.")
  parser.add_argument("--db-path", default=DEFAULT_DB_PATH, help=f"SQLite path (default: {DEFAULT_DB_PATH})")
  parser.add_argument("--api-url", default=DEFAULT_API_URL, help=f"DIP API base URL (default: {DEFAULT_API_URL})")
  parser.add_argument("--config-url", default=DEFAULT_CONFIG_URL, help=f"DIP config URL used for API key fallback (default: {DEFAULT_CONFIG_URL})")
  parser.add_argument("--api-key", default=None, help="DIP API key (falls back to env or dip-config.js)")
  parser.add_argument(
    "--wahlperiode",
    action="append",
    default=[],
    help=f"Bundestag Wahlperiode filter, repeatable (default: {DEFAULT_WAHLPERIODE})",
  )
  parser.add_argument("--query", default=None, help="Optional full-text query (q)")
  parser.add_argument("--vorgangstyp", action="append", default=[], help="Optional vorgangstyp filter, repeatable")
  parser.add_argument("--max-documents", type=int, default=None, help="Maximum number of documents to process")
  parser.add_argument("--max-pages", type=int, default=None, help="Maximum number of API pages to fetch")
  parser.add_argument(
    "--stop-after-existing",
    type=int,
    default=None,
    help="Stop after N consecutive already-known DIP IDs (useful for fast incremental updates).",
  )
  parser.add_argument("--only-missing", action="store_true", help="Only ingest DIP IDs not already in preparatory_works")
  parser.add_argument("--refresh-existing", action="store_true", help="Re-ingest existing DIP IDs as updates")
  parser.add_argument("--sleep-seconds", type=float, default=DEFAULT_SLEEP_SECONDS, help="Pause between API pages")
  parser.add_argument("--timeout", type=int, default=DEFAULT_TIMEOUT, help=f"HTTP timeout in seconds (default: {DEFAULT_TIMEOUT})")
  parser.add_argument("--retries", type=int, default=DEFAULT_RETRIES, help=f"HTTP retries (default: {DEFAULT_RETRIES})")
  parser.add_argument("--quiet", action="store_true", help="Suppress per-document progress logs")
  parser.add_argument("--dry-run", action="store_true", help="Resolve and report ingestion scope only")
  parser.add_argument("--report-path", default=None, help="Optional path to write summary JSON")
  return parser.parse_args(argv)


def run_ingestion(args: argparse.Namespace) -> dict[str, object]:
  started_at = now_iso()
  api_key = resolve_api_key(args)
  wahlperioden = [value.strip() for value in args.wahlperiode if value.strip()]
  if not wahlperioden:
    wahlperioden = [DEFAULT_WAHLPERIODE]
  vorgangstyp = [value.strip() for value in args.vorgangstyp if value.strip()]

  connection = sqlite3.connect(args.db_path)
  connection.row_factory = sqlite3.Row
  ensure_schema(connection)
  existing_ids = fetch_existing_dip_ids(connection) if args.only_missing else set()
  statute_code_map = load_statute_code_map(connection)

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
    source_id="dip-bundestag",
    started_at=started_at,
  )

  headers = {
    "Accept": "application/json",
    "Origin": "https://dip.bundestag.de",
    "Referer": "https://dip.bundestag.de/",
    "User-Agent": "Mozilla/5.0",
  }

  page_count = 0
  cursor: str | None = None
  total_found: int | None = None
  selected_documents = 0
  ingested_documents = 0
  skipped_documents = 0
  error_count = 0
  errors: list[str] = []
  consecutive_existing = 0
  stop_reason: str | None = None

  while True:
    if args.max_pages is not None and args.max_pages >= 0 and page_count >= args.max_pages:
      break
    if args.max_documents is not None and args.max_documents >= 0 and selected_documents >= args.max_documents:
      break

    page_url = build_search_url(
      args.api_url,
      api_key,
      cursor=cursor,
      query=args.query,
      wahlperioden=wahlperioden,
      vorgangstyp=vorgangstyp,
    )

    payload = parse_json_response(
      http_get(page_url, timeout=args.timeout, retries=args.retries, headers=headers),
      source=page_url,
    )
    page_count += 1
    if total_found is None:
      total_found = int(payload.get("numFound", 0) or 0)

    documents = payload.get("documents", [])
    if not isinstance(documents, list) or len(documents) == 0:
      break

    for document in documents:
      if args.max_documents is not None and args.max_documents >= 0 and selected_documents >= args.max_documents:
        break
      if not isinstance(document, dict):
        continue

      dip_id = collapse_whitespace(str(document.get("id", "")))
      if not dip_id:
        continue

      already_exists = dip_id in existing_ids
      if args.only_missing and already_exists and not args.refresh_existing:
        skipped_documents += 1
        consecutive_existing += 1
        if (
          args.stop_after_existing is not None
          and args.stop_after_existing >= 0
          and consecutive_existing >= args.stop_after_existing
        ):
          stop_reason = "consecutive_existing_threshold"
          break
        continue

      consecutive_existing = 0
      selected_documents += 1

      title = collapse_whitespace(str(document.get("titel", ""))) or f"Vorgang {dip_id}"
      abstract = collapse_whitespace(str(document.get("abstract", "")))
      publication_date = normalize_iso_date(str(document.get("datum", "")))
      work_type = collapse_whitespace(str(document.get("vorgangstyp", ""))) or None
      descriptors = extract_descriptor_names(document)
      citations = extract_citation_candidates(document)
      statute_citation = " | ".join(citations[:4]) if citations else None

      initiative_raw = document.get("initiative")
      initiative: list[str] = []
      if isinstance(initiative_raw, list):
        initiative = [collapse_whitespace(str(item)) for item in initiative_raw if collapse_whitespace(str(item))]

      statute_id = derive_statute_id(title, abstract, descriptors, citations, statute_code_map)
      text_snippet = build_text_snippet(title, abstract, descriptors, initiative, citations)
      source_url = f"{args.api_url.rstrip('/')}/{urllib.parse.quote(dip_id)}"

      metadata_payload = {
        "source": "dip-bundestag",
        "dip_id": dip_id,
        "typ": collapse_whitespace(str(document.get("typ", ""))) or None,
        "wahlperiode": str(document.get("wahlperiode", "")) or None,
        "vorgangstyp": work_type,
        "beratungsstand": collapse_whitespace(str(document.get("beratungsstand", ""))) or None,
        "aktualisiert": collapse_whitespace(str(document.get("aktualisiert", ""))) or None,
        "initiative": " | ".join(initiative) if initiative else None,
        "deskriptor": " | ".join(descriptors) if descriptors else None,
        "query": args.query or None,
      }
      metadata_compact = {key: value for key, value in metadata_payload.items() if value not in (None, "")}
      metadata_json = json.dumps(metadata_compact, ensure_ascii=False)

      if args.dry_run:
        continue

      try:
        if not args.quiet:
          print(f"[ingest] page={page_count} dip_id={dip_id} title={title[:90]}", file=sys.stderr)
        upsert_preparatory_work(
          connection=connection,
          dip_id=dip_id,
          title=title,
          statute_id=statute_id,
          statute_citation=statute_citation,
          work_type=work_type,
          publication_date=publication_date,
          source_url=source_url,
          text_snippet=text_snippet,
          metadata_json=metadata_json,
        )
        ingested_documents += 1
      except Exception as error:  # noqa: BLE001
        error_count += 1
        message = f"{dip_id}: {error}"
        errors.append(message)
        if not args.quiet:
          print(f"[error] {message}", file=sys.stderr)

    next_cursor = payload.get("cursor")
    if stop_reason:
      break
    if not next_cursor or not isinstance(next_cursor, str) or next_cursor == cursor:
      break
    cursor = next_cursor

    if args.sleep_seconds > 0:
      time.sleep(args.sleep_seconds)

  finished_at = now_iso()
  status = "dry_run" if args.dry_run else "success"
  if not args.dry_run and error_count > 0 and ingested_documents == 0:
    status = "failed"
  elif not args.dry_run and error_count > 0:
    status = "partial_success"

  finalize_ingestion_run(
    connection=connection,
    run_id=run_id,
    finished_at=finished_at,
    status=status,
    total_documents=selected_documents,
    ingested_documents=ingested_documents,
    skipped_documents=skipped_documents,
    error_count=error_count,
    error_sample=errors,
  )
  connection.commit()
  connection.close()

  return {
    "started_at": started_at,
    "finished_at": finished_at,
    "status": status,
    "source_id": "dip-bundestag",
    "db_path": args.db_path,
    "wahlperioden": wahlperioden,
    "query": args.query,
    "vorgangstyp": vorgangstyp,
    "api_total_found": total_found,
    "pages_fetched": page_count,
    "selected_documents": selected_documents,
    "ingested_documents": ingested_documents,
    "skipped_documents": skipped_documents,
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
      "source_id": "dip-bundestag",
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
