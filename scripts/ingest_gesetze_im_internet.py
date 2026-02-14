#!/usr/bin/env python3
"""
Ingest German federal legislation from Gesetze im Internet into SQLite.

Data source:
  - https://www.gesetze-im-internet.de/gii-toc.xml
  - Per-statute XML package links listed in the TOC
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
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from dataclasses import dataclass
from typing import Iterable
from xml.etree import ElementTree as ET

DEFAULT_TOC_URL = "https://www.gesetze-im-internet.de/gii-toc.xml"
DEFAULT_DB_PATH = "data/database.db"
DEFAULT_TIMEOUT = 60
DEFAULT_RETRIES = 3
DEFAULT_SLEEP_SECONDS = 0.0
USER_AGENT = "ansvar-german-law-mcp/0.1"
NO_PROXY_OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))

PROVISION_HINT_PATTERN = re.compile(r"^(§{1,2}|Art\.?|Artikel)\s*", re.IGNORECASE)
HIERARCHY_LABEL_PATTERN = re.compile(
    r"^(Inhaltsübersicht|Buch|Teil|Abschnitt|Unterabschnitt|Titel|Untertitel|Kapitel|Anlage)\b",
    re.IGNORECASE,
)
WHITESPACE_PATTERN = re.compile(r"\s+")

SCHEMA_SQL = """
PRAGMA journal_mode = DELETE;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS statutes (
  statute_id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  jurabk TEXT,
  amtabk TEXT,
  full_title TEXT,
  issue_date TEXT,
  source_url TEXT NOT NULL,
  xml_url TEXT NOT NULL,
  section_count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS law_documents (
  id TEXT PRIMARY KEY,
  country TEXT NOT NULL,
  statute_id TEXT NOT NULL REFERENCES statutes(statute_id) ON DELETE CASCADE,
  section_ref TEXT NOT NULL,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  citation TEXT,
  source_url TEXT,
  effective_date TEXT,
  text_snippet TEXT,
  metadata_json TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(statute_id, section_ref)
);

CREATE INDEX IF NOT EXISTS idx_law_documents_statute ON law_documents(statute_id);
CREATE INDEX IF NOT EXISTS idx_law_documents_citation ON law_documents(citation);
CREATE INDEX IF NOT EXISTS idx_law_documents_country ON law_documents(country);

CREATE VIRTUAL TABLE IF NOT EXISTS law_documents_fts USING fts5(
  title,
  citation,
  text_snippet,
  content='law_documents',
  content_rowid='rowid',
  tokenize='unicode61'
);

CREATE TRIGGER IF NOT EXISTS law_documents_ai
AFTER INSERT ON law_documents
BEGIN
  INSERT INTO law_documents_fts(rowid, title, citation, text_snippet)
  VALUES (new.rowid, new.title, COALESCE(new.citation, ''), COALESCE(new.text_snippet, ''));
END;

CREATE TRIGGER IF NOT EXISTS law_documents_ad
AFTER DELETE ON law_documents
BEGIN
  INSERT INTO law_documents_fts(law_documents_fts, rowid, title, citation, text_snippet)
  VALUES ('delete', old.rowid, old.title, COALESCE(old.citation, ''), COALESCE(old.text_snippet, ''));
END;

CREATE TRIGGER IF NOT EXISTS law_documents_au
AFTER UPDATE ON law_documents
BEGIN
  INSERT INTO law_documents_fts(law_documents_fts, rowid, title, citation, text_snippet)
  VALUES ('delete', old.rowid, old.title, COALESCE(old.citation, ''), COALESCE(old.text_snippet, ''));
  INSERT INTO law_documents_fts(rowid, title, citation, text_snippet)
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
  statute_id: str
  title: str
  xml_url: str


@dataclass
class ParsedStatute:
  statute_id: str
  title: str
  jurabk: str | None
  amtabk: str | None
  full_title: str | None
  issue_date: str | None
  source_url: str
  xml_url: str
  rows: list[tuple[str, str, str, str, str, str | None, str, str | None, str, str]]


def now_iso() -> str:
  return dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z")


def collapse_whitespace(value: str | None) -> str:
  if not value:
    return ""
  return WHITESPACE_PATTERN.sub(" ", value).strip()


def normalize_ascii_slug(value: str) -> str:
  normalized = unicodedata.normalize("NFKD", value)
  ascii_only = normalized.encode("ascii", "ignore").decode("ascii")
  cleaned = re.sub(r"[^a-zA-Z0-9]+", "-", ascii_only).strip("-").lower()
  return cleaned or "section"


def text_of(element: ET.Element | None, tag: str) -> str | None:
  if element is None:
    return None
  child = element.find(tag)
  if child is None:
    return None
  return collapse_whitespace("".join(child.itertext()))


def normalize_xml_url(raw_url: str) -> str:
  parsed = urllib.parse.urlparse(raw_url.strip())
  path = parsed.path
  if not path:
    raise ValueError(f"Invalid XML URL in TOC: {raw_url}")
  return urllib.parse.urlunparse(("https", "www.gesetze-im-internet.de", path, "", "", ""))


def extract_statute_id(raw_url: str) -> str:
  parsed = urllib.parse.urlparse(raw_url.strip())
  path = parsed.path.strip("/")
  if path.endswith("/xml.zip"):
    return path[: -len("/xml.zip")]
  if path.endswith("xml.zip"):
    return path[: -len("xml.zip")].rstrip("/")
  return path


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
    title = collapse_whitespace(item.findtext("title"))
    link = collapse_whitespace(item.findtext("link"))
    if not title or not link:
      continue
    statute_id = extract_statute_id(link)
    if not statute_id:
      continue
    xml_url = normalize_xml_url(link)
    items.append(TocItem(statute_id=statute_id, title=title, xml_url=xml_url))

  return items


def extract_norm_text(norm: ET.Element) -> str:
  content_node = norm.find("./textdaten/text/Content")
  if content_node is None:
    content_node = norm.find("./textdaten/text")
  if content_node is None:
    content_node = norm.find("./textdaten")
  if content_node is None:
    return ""

  raw_text = " ".join(collapse_whitespace(part) for part in content_node.itertext())
  return collapse_whitespace(raw_text)


def should_index_section(section_ref: str, content: str) -> bool:
  if not section_ref:
    return False
  if HIERARCHY_LABEL_PATTERN.match(section_ref):
    return False
  if len(content) < 4:
    return False
  return bool(PROVISION_HINT_PATTERN.match(section_ref) or re.search(r"\d", section_ref))


def make_source_url(statute_id: str) -> str:
  quoted = urllib.parse.quote(statute_id, safe="/-_")
  return f"https://www.gesetze-im-internet.de/{quoted}/index.html"


def make_document_id(statute_id: str, section_ref: str, seen: set[str], norm_doknr: str | None) -> str:
  base = f"{statute_id}:{normalize_ascii_slug(section_ref)}"
  candidate = base
  if candidate not in seen:
    seen.add(candidate)
    return candidate

  if norm_doknr:
    with_doknr = f"{base}:{normalize_ascii_slug(norm_doknr)}"
    if with_doknr not in seen:
      seen.add(with_doknr)
      return with_doknr

  suffix = 2
  while True:
    candidate = f"{base}:{suffix}"
    if candidate not in seen:
      seen.add(candidate)
      return candidate
    suffix += 1


def dedupe_section_ref(section_ref: str, seen_section_refs: dict[str, int]) -> str:
  count = seen_section_refs.get(section_ref, 0) + 1
  seen_section_refs[section_ref] = count
  if count == 1:
    return section_ref
  return f"{section_ref} [{count}]"


def parse_statute_package(item: TocItem, zip_payload: bytes) -> ParsedStatute:
  with zipfile.ZipFile(io.BytesIO(zip_payload), "r") as archive:
    xml_members = [name for name in archive.namelist() if name.lower().endswith(".xml")]
    if not xml_members:
      raise RuntimeError(f"No XML file found in archive for {item.statute_id}")
    xml_payload = archive.read(xml_members[0])

  root = ET.fromstring(xml_payload)
  norms = root.findall("./norm")
  if not norms:
    raise RuntimeError(f"No <norm> entries found for {item.statute_id}")

  main_meta = norms[0].find("metadaten")
  jurabk = text_of(main_meta, "jurabk")
  amtabk = text_of(main_meta, "amtabk")
  full_title = text_of(main_meta, "langue")
  issue_date = text_of(main_meta, "ausfertigung-datum")
  source_url = make_source_url(item.statute_id)
  base_title = full_title or item.title

  rows: list[tuple[str, str, str, str, str, str | None, str, str | None, str, str]] = []
  seen_ids: set[str] = set()
  seen_section_refs: dict[str, int] = {}

  for norm in norms:
    metadata = norm.find("metadaten")
    if metadata is None:
      continue

    section_ref = collapse_whitespace(text_of(metadata, "enbez"))
    section_title = collapse_whitespace(text_of(metadata, "titel"))
    norm_doknr = collapse_whitespace(norm.attrib.get("doknr", ""))
    text_body = extract_norm_text(norm)

    if not should_index_section(section_ref, text_body):
      continue

    section_ref_for_db = dedupe_section_ref(section_ref, seen_section_refs)
    document_id = make_document_id(item.statute_id, section_ref, seen_ids, norm_doknr or None)
    citation_code = jurabk or amtabk or item.statute_id.upper()
    citation = collapse_whitespace(f"{section_ref} {citation_code}")
    title_suffix = section_title or section_ref
    row_title = collapse_whitespace(f"{base_title} - {title_suffix}")

    metadata_payload = {
      "source": "gesetze-im-internet",
      "statute_id": item.statute_id,
      "jurabk": jurabk,
      "amtabk": amtabk,
      "full_title": full_title,
      "toc_title": item.title,
      "section_ref": section_ref,
      "section_title": section_title or None,
      "norm_doknr": norm_doknr or None,
      "xml_url": item.xml_url,
    }
    metadata_compact = {key: value for key, value in metadata_payload.items() if value is not None and value != ""}

    rows.append(
      (
        document_id,
        "de",
        item.statute_id,
        section_ref_for_db,
        "statute",
        row_title,
        citation,
        source_url,
        issue_date or None,
        text_body,
        json.dumps(metadata_compact, ensure_ascii=False),
      )
    )

  return ParsedStatute(
    statute_id=item.statute_id,
    title=item.title,
    jurabk=jurabk,
    amtabk=amtabk,
    full_title=full_title,
    issue_date=issue_date,
    source_url=source_url,
    xml_url=item.xml_url,
    rows=rows,
  )


def ensure_schema(connection: sqlite3.Connection) -> None:
  connection.executescript(SCHEMA_SQL)


def insert_ingestion_run_start(connection: sqlite3.Connection, source_id: str, started_at: str, total_laws: int) -> int:
  cursor = connection.execute(
    """
    INSERT INTO ingestion_runs (source_id, started_at, status, total_laws)
    VALUES (?, ?, 'running', ?)
    """,
    (source_id, started_at, total_laws),
  )
  return int(cursor.lastrowid)


def finalize_ingestion_run(
  connection: sqlite3.Connection,
  run_id: int,
  *,
  finished_at: str,
  status: str,
  ingested_laws: int,
  skipped_laws: int,
  ingested_sections: int,
  skipped_sections: int,
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
      ingested_laws,
      skipped_laws,
      ingested_sections,
      skipped_sections,
      error_count,
      json.dumps(error_sample[:20], ensure_ascii=False) if error_sample else None,
      notes,
      run_id,
    ),
  )


def statute_exists(connection: sqlite3.Connection, statute_id: str) -> tuple[bool, int]:
  row = connection.execute(
    "SELECT section_count FROM statutes WHERE statute_id = ? LIMIT 1",
    (statute_id,),
  ).fetchone()
  if not row:
    return (False, 0)
  return (True, int(row[0] or 0))


def upsert_statute_and_rows(connection: sqlite3.Connection, statute: ParsedStatute) -> tuple[int, int]:
  existing_count_row = connection.execute(
    "SELECT COUNT(*) FROM law_documents WHERE statute_id = ?",
    (statute.statute_id,),
  ).fetchone()
  existing_count = int(existing_count_row[0]) if existing_count_row else 0

  now = now_iso()
  with connection:
    connection.execute("DELETE FROM law_documents WHERE statute_id = ?", (statute.statute_id,))
    connection.execute(
      """
      INSERT INTO statutes (
        statute_id, title, jurabk, amtabk, full_title, issue_date, source_url, xml_url, section_count, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(statute_id) DO UPDATE SET
        title = excluded.title,
        jurabk = excluded.jurabk,
        amtabk = excluded.amtabk,
        full_title = excluded.full_title,
        issue_date = excluded.issue_date,
        source_url = excluded.source_url,
        xml_url = excluded.xml_url,
        section_count = excluded.section_count,
        updated_at = excluded.updated_at
      """,
      (
        statute.statute_id,
        statute.title,
        statute.jurabk,
        statute.amtabk,
        statute.full_title,
        statute.issue_date,
        statute.source_url,
        statute.xml_url,
        len(statute.rows),
        now,
      ),
    )

    if statute.rows:
      connection.executemany(
        """
        INSERT INTO law_documents (
          id, country, statute_id, section_ref, kind, title, citation, source_url, effective_date, text_snippet, metadata_json, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          country = excluded.country,
          statute_id = excluded.statute_id,
          section_ref = excluded.section_ref,
          kind = excluded.kind,
          title = excluded.title,
          citation = excluded.citation,
          source_url = excluded.source_url,
          effective_date = excluded.effective_date,
          text_snippet = excluded.text_snippet,
          metadata_json = excluded.metadata_json,
          updated_at = excluded.updated_at
        """,
        [(*row, now) for row in statute.rows],
      )

  ingested_sections = len(statute.rows)
  skipped_sections = max(existing_count - ingested_sections, 0)
  return (ingested_sections, skipped_sections)


def parse_args(argv: list[str]) -> argparse.Namespace:
  parser = argparse.ArgumentParser(description="Ingest Gesetze im Internet XML packages into SQLite.")
  parser.add_argument("--db-path", default=DEFAULT_DB_PATH, help=f"SQLite path (default: {DEFAULT_DB_PATH})")
  parser.add_argument("--toc-url", default=DEFAULT_TOC_URL, help=f"TOC XML URL (default: {DEFAULT_TOC_URL})")
  parser.add_argument("--max-laws", type=int, default=None, help="Maximum number of statutes to ingest")
  parser.add_argument("--offset", type=int, default=0, help="Skip first N TOC entries")
  parser.add_argument("--statute-id", action="append", default=[], help="Only ingest the selected statute id (repeatable)")
  parser.add_argument("--title-contains", default=None, help="Only ingest statutes whose title contains this string")
  parser.add_argument("--only-missing", action="store_true", help="Only ingest statutes that are not yet present in table statutes")
  parser.add_argument("--refresh-existing", action="store_true", help="Re-ingest statutes already present in the database")
  parser.add_argument("--sleep-seconds", type=float, default=DEFAULT_SLEEP_SECONDS, help="Pause between statute downloads")
  parser.add_argument("--timeout", type=int, default=DEFAULT_TIMEOUT, help=f"HTTP timeout in seconds (default: {DEFAULT_TIMEOUT})")
  parser.add_argument("--retries", type=int, default=DEFAULT_RETRIES, help=f"HTTP retries (default: {DEFAULT_RETRIES})")
  parser.add_argument("--quiet", action="store_true", help="Suppress per-statute progress logs")
  parser.add_argument("--dry-run", action="store_true", help="Resolve and report ingestion scope only")
  parser.add_argument("--report-path", default=None, help="Optional path to write summary JSON")
  return parser.parse_args(argv)


def filter_items(items: Iterable[TocItem], args: argparse.Namespace) -> list[TocItem]:
  filtered = list(items)

  if args.statute_id:
    selected = {value.strip() for value in args.statute_id if value.strip()}
    filtered = [item for item in filtered if item.statute_id in selected]

  if args.title_contains:
    needle = args.title_contains.lower()
    filtered = [item for item in filtered if needle in item.title.lower()]

  if args.offset > 0:
    filtered = filtered[args.offset :]

  if args.max_laws is not None and args.max_laws >= 0 and not args.only_missing:
    filtered = filtered[: args.max_laws]

  return filtered


def fetch_existing_statute_ids(connection: sqlite3.Connection) -> set[str]:
  rows = connection.execute("SELECT statute_id FROM statutes").fetchall()
  return {str(row[0]) for row in rows}


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
      existing_ids = fetch_existing_statute_ids(connection)
      selected_items = [item for item in selected_items if item.statute_id not in existing_ids]
      if args.max_laws is not None and args.max_laws >= 0:
        selected_items = selected_items[: args.max_laws]
      existing_count = len(existing_ids)
      missing_count = len(selected_items)
      connection.close()

    summary: dict[str, object] = {
      "started_at": started_at,
      "finished_at": now_iso(),
      "status": "dry_run",
      "source_id": "gesetze-im-internet",
      "toc_total_laws": len(toc_items),
      "selected_laws": len(selected_items),
      "sample_statute_ids": [item.statute_id for item in selected_items[:10]],
    }
    if existing_count is not None:
      summary["existing_statutes"] = existing_count
    if missing_count is not None:
      summary["missing_statutes"] = missing_count
    return summary

  connection = sqlite3.connect(args.db_path)
  connection.row_factory = sqlite3.Row
  ensure_schema(connection)
  if args.only_missing:
    existing_ids = fetch_existing_statute_ids(connection)
    selected_items = [item for item in selected_items if item.statute_id not in existing_ids]
    if args.max_laws is not None and args.max_laws >= 0:
      selected_items = selected_items[: args.max_laws]
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
    source_id="gesetze-im-internet",
    started_at=started_at,
    total_laws=len(selected_items),
  )

  ingested_laws = 0
  skipped_laws = 0
  ingested_sections = 0
  skipped_sections = 0
  error_count = 0
  errors: list[str] = []

  for index, item in enumerate(selected_items, start=1):
    try:
      exists, existing_sections = statute_exists(connection, item.statute_id)
      if exists and not args.refresh_existing:
        skipped_laws += 1
        skipped_sections += existing_sections
        if not args.quiet:
          print(
            f"[skip] {index}/{len(selected_items)} {item.statute_id} "
            f"(already ingested, sections={existing_sections})",
            file=sys.stderr,
          )
        continue

      if not args.quiet:
        print(
          f"[ingest] {index}/{len(selected_items)} {item.statute_id} :: {item.title}",
          file=sys.stderr,
        )
      zip_payload = http_get(item.xml_url, timeout=args.timeout, retries=args.retries)
      parsed_statute = parse_statute_package(item, zip_payload)
      inserted_sections, removed_sections = upsert_statute_and_rows(connection, parsed_statute)

      ingested_laws += 1
      ingested_sections += inserted_sections
      skipped_sections += removed_sections

      if args.sleep_seconds > 0:
        time.sleep(args.sleep_seconds)
    except Exception as error:  # noqa: BLE001
      error_count += 1
      message = f"{item.statute_id}: {error}"
      errors.append(message)
      if not args.quiet:
        print(f"[error] {message}", file=sys.stderr)

  finished_at = now_iso()
  status = "success"
  if error_count > 0 and ingested_laws == 0:
    status = "failed"
  elif error_count > 0:
    status = "partial_success"

  finalize_ingestion_run(
    connection=connection,
    run_id=run_id,
    finished_at=finished_at,
    status=status,
    ingested_laws=ingested_laws,
    skipped_laws=skipped_laws,
    ingested_sections=ingested_sections,
    skipped_sections=skipped_sections,
    error_count=error_count,
    error_sample=errors,
  )
  connection.commit()
  connection.close()

  summary = {
    "started_at": started_at,
    "finished_at": finished_at,
    "status": status,
    "source_id": "gesetze-im-internet",
    "db_path": args.db_path,
    "toc_total_laws": len(toc_items),
    "selected_laws": len(selected_items),
    "existing_statutes_before_run": len(existing_ids),
    "ingested_laws": ingested_laws,
    "skipped_laws": skipped_laws,
    "ingested_sections": ingested_sections,
    "skipped_sections": skipped_sections,
    "error_count": error_count,
    "error_sample": errors[:10],
  }
  return summary


def main(argv: list[str]) -> int:
  args = parse_args(argv)
  try:
    summary = run_ingestion(args)
  except Exception as error:  # noqa: BLE001
    failure_summary = {
      "started_at": now_iso(),
      "finished_at": now_iso(),
      "status": "failed",
      "source_id": "gesetze-im-internet",
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
