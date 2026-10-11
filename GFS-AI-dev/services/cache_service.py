# services/cache_service.py
# ─────────────────────────────────────────────────────────────────────────────
# Document-Level Deduplication & AI Processing Cache Service
# Provides SHA-256 content hashing, MongoDB cache lookup, race-condition
# handling (atomic locks), and result persistence.
# ─────────────────────────────────────────────────────────────────────────────

import hashlib
import logging
import os
import threading
import time
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterator, List, Optional
from pymongo.errors import DuplicateKeyError

logger = logging.getLogger("gfs.cache_service")

# ── Processing-lock liveness ─────────────────────────────────────────────────
# A leader pipeline can legitimately run 10-20+ min (heavy vision queues), far
# longer than the old 180s follower wait. And a redeploy / crash can kill the
# leader without marking the cache row, orphaning a PROCESSING lock that every
# later duplicate then waits out in full before running a duplicate pipeline
# anyway (Jane St ran 3x for exactly this reason).
#
# Fix: the leader heartbeats `updated_at` every minute while it runs; any
# PROCESSING lock older than LOCK_TTL_S is treated as dead and may be stolen
# by the next claimant. Follower wait raised to 900s so duplicates actually
# wait out a real leader instead of duplicating it.
def _env_float(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, default))
    except (ValueError, TypeError):
        return float(default)


LOCK_TTL_S = _env_float("GFS_PROCESSING_LOCK_TTL_S", 600)      # stale-lock threshold
HEARTBEAT_INTERVAL_S = _env_float("GFS_LOCK_HEARTBEAT_S", 60)  # leader heartbeat cadence
CONCURRENT_WAIT_S = _env_float("GFS_CONCURRENT_WAIT_S", 900)  # follower max wait


def _parse_ts(ts: Any) -> Optional[datetime]:
    try:
        if not ts:
            return None
        dt = datetime.fromisoformat(str(ts))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except Exception:
        return None


def _lock_age_seconds(doc: Optional[Dict[str, Any]]) -> float:
    """Age of a PROCESSING lock based on updated_at; +inf if unparseable."""
    if not doc:
        return float("inf")
    dt = _parse_ts(doc.get("updated_at")) or _parse_ts(doc.get("created_at"))
    if dt is None:
        return float("inf")
    return (datetime.now(timezone.utc) - dt).total_seconds()

_mongo_client = None


def _get_mongo_db():
    """Gets the PyMongo database instance matching the configured MongoDB URI."""
    global _mongo_client
    if _mongo_client is None:
        from pymongo import MongoClient

        mongo_uri = (
            os.environ.get("MONGODB_URI")
            or os.environ.get("MONGO_URI")
            or os.environ.get("MONGODB_URL")
        )
        if not mongo_uri:
            raise ValueError("MONGODB_URI / MONGO_URI environment variable not set")
        _mongo_client = MongoClient(mongo_uri)

    db_name = os.environ.get("DATABASE_NAME")
    if not db_name:
        # Extract from MONGODB_URI path: mongodb://host:port/DB_NAME[?params]
        import re as _re
        mongo_uri = os.environ.get("MONGODB_URI") or os.environ.get("MONGO_URI") or os.environ.get("MONGODB_URL") or ""
        m = _re.search(r"/([^/?]+)(\?|$)", mongo_uri)
        db_name = m.group(1) if m else "smartmfg_ai"
    return _mongo_client[db_name]


def get_cache_collection():
    """
    Returns the document_processing_cache collection and ensures
    a unique index on content_hash.
    """
    db = _get_mongo_db()
    collection = db["document_processing_cache"]
    # Ensure unique index on content_hash
    try:
        collection.create_index([("content_hash", 1)], unique=True, background=True)
    except Exception as e:
        logger.warning("Could not create unique index on document_processing_cache: %s", e)
    return collection


def compute_file_sha256(file_path: Path) -> str:
    """Computes SHA-256 hex digest of a single file's raw bytes."""
    h = hashlib.sha256()
    with open(file_path, "rb") as fh:
        for chunk in iter(lambda: fh.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def compute_documents_hash(folder: Path, context: Optional[str] = None) -> str:
    """
    Computes a deterministic content hash for all document files in a folder,
    optionally incorporating user/context text.
    - If 1 file and no context: returns SHA-256 of that file's bytes.
    - If multiple files or context present: sorts file hashes deterministically and returns SHA-256 of combined hashes + context.
    """
    folder = Path(folder).resolve()
    exts = {".pdf", ".eml", ".msg", ".png", ".jpg", ".jpeg", ".txt", ".dwg", ".vtt", ".docx"}
    
    file_hashes: List[str] = []
    
    for p in sorted(folder.rglob("*")):
        if not p.is_file():
            continue
        if p.suffix.lower() not in exts:
            continue
        if p.name.startswith("._") or "__macosx" in str(p).lower():
            continue
        if any(x in p.parts for x in ("extraction_results", "non_ai_results", "azure_results", "flagged_figures", "citations_output")):
            continue
        
        file_hashes.append(compute_file_sha256(p))

    if not file_hashes:
        raise FileNotFoundError(f"No processable document files found in {folder}")

    if len(file_hashes) == 1 and not context:
        return file_hashes[0]

    # Deterministic combination for multi-file submissions and/or context
    sorted_hashes = sorted(file_hashes)
    combined = hashlib.sha256()
    for h in sorted_hashes:
        combined.update(h.encode("utf-8"))
    if context:
        combined.update(context.strip().encode("utf-8"))
    return combined.hexdigest()


def get_cached_result(content_hash: str) -> Optional[Dict[str, Any]]:
    """
    Checks if a completed processing result exists for the given content hash.
    Returns the document dict if COMPLETED or PHASE1_COMPLETED, else None.
    """
    col = get_cache_collection()
    doc = col.find_one({"content_hash": content_hash})
    if doc and doc.get("processing_status") in ("COMPLETED", "PHASE1_COMPLETED"):
        return doc
    return None


def claim_processing_lock(content_hash: str, pipeline_version: str = "v1") -> bool:
    """
    Attempts to atomically claim a processing lock for content_hash by inserting
    a record with status 'PROCESSING'.
    Returns True if lock claimed (this process is leader).
    Returns False if lock already claimed by another process (DuplicateKeyError).

    Stale-lock takeover: a PROCESSING lock whose updated_at is older than
    LOCK_TTL_S belongs to a dead leader (crash/redeploy with no heartbeat) and
    is atomically stolen. The steal is conditional on the exact old timestamp
    so two racers can't both win.
    """
    col = get_cache_collection()
    now_str = datetime.now(timezone.utc).isoformat()
    record = {
        "content_hash": content_hash,
        "processing_status": "PROCESSING",
        "pipeline_version": pipeline_version,
        "extracted_result": None,
        "error_message": None,
        "created_at": now_str,
        "updated_at": now_str,
    }
    try:
        col.insert_one(record)
        logger.info("Claimed processing lock for content_hash=%s", content_hash)
        return True
    except DuplicateKeyError:
        # Check if existing record is FAILED — if failed, allow overwrite/retry
        existing = col.find_one({"content_hash": content_hash})
        if existing and existing.get("processing_status") == "FAILED":
            res = col.update_one(
                {"content_hash": content_hash, "processing_status": "FAILED"},
                {"$set": {
                    "processing_status": "PROCESSING",
                    "error_message": None,
                    "updated_at": now_str
                }}
            )
            if res.modified_count > 0:
                logger.info("Reset FAILED cache entry and claimed lock for content_hash=%s", content_hash)
                return True
        # Stale PROCESSING lock (dead leader) — steal it atomically.
        if existing and existing.get("processing_status") == "PROCESSING":
            age = _lock_age_seconds(existing)
            if age > LOCK_TTL_S:
                old_updated = existing.get("updated_at")
                res = col.update_one(
                    {
                        "content_hash": content_hash,
                        "processing_status": "PROCESSING",
                        "updated_at": old_updated,
                    },
                    {"$set": {
                        "processing_status": "PROCESSING",
                        "error_message": None,
                        "pipeline_version": pipeline_version,
                        "updated_at": now_str,
                    }},
                )
                if res.modified_count > 0:
                    logger.warning(
                        "Stole stale PROCESSING lock for content_hash=%s (age %.0fs > TTL %.0fs)",
                        content_hash, age, LOCK_TTL_S,
                    )
                    return True
                logger.info(
                    "Stale lock for content_hash=%s was taken by a racer; treating as claimed elsewhere",
                    content_hash,
                )
                return False
        logger.info("Processing lock for content_hash=%s already claimed by another thread/process", content_hash)
        return False
    except Exception as exc:
        logger.warning("Error claiming processing lock for content_hash=%s: %s", content_hash, exc)
        return False


def heartbeat_processing_lock(content_hash: str) -> bool:
    """
    Refresh a live leader's lock so followers don't mistake it for dead.
    Only touches rows still in PROCESSING state. Returns True if refreshed.
    """
    try:
        col = get_cache_collection()
        res = col.update_one(
            {"content_hash": content_hash, "processing_status": "PROCESSING"},
            {"$set": {"updated_at": datetime.now(timezone.utc).isoformat()}},
        )
        return res.modified_count > 0
    except Exception as exc:
        logger.warning("Heartbeat failed for content_hash=%s: %s", content_hash, exc)
        return False


@contextmanager
def processing_heartbeat(content_hash: str, interval_s: Optional[float] = None) -> Iterator[None]:
    """
    Context manager for leaders: beats the processing lock every `interval_s`
    on a daemon thread until the block exits. Usage::

        if claim_processing_lock(h):
            with processing_heartbeat(h):
                run_pipeline(...)
    """
    interval = interval_s or HEARTBEAT_INTERVAL_S
    stop = threading.Event()

    def _beat() -> None:
        while not stop.wait(interval):
            if not heartbeat_processing_lock(content_hash):
                return

    t = threading.Thread(target=_beat, name=f"lock-heartbeat-{content_hash[:8]}", daemon=True)
    t.start()
    try:
        yield
    finally:
        stop.set()


def wait_for_processing(
    content_hash: str,
    timeout_seconds: Optional[int] = None,
    poll_interval: float = 2.0
) -> Optional[Dict[str, Any]]:
    """
    Polls the cache table when another concurrent process is currently processing
    the same document hash.
    Waits until status becomes COMPLETED, PHASE1_COMPLETED, or FAILED, or timeout_seconds elapses.
    Default timeout (900s) covers a real heavy pipeline run; pass explicitly to override.

    Returns None early (without waiting out the clock) if the lock is stale --
    i.e. PROCESSING but older than LOCK_TTL_S -- so the caller can steal it and
    proceed instead of idling for the full timeout on a dead leader.
    """
    if timeout_seconds is None:
        timeout_seconds = int(CONCURRENT_WAIT_S)
    col = get_cache_collection()
    start_time = time.monotonic()

    logger.info("Waiting for concurrent processing of content_hash=%s (timeout=%ds)...", content_hash, timeout_seconds)

    while (time.monotonic() - start_time) < timeout_seconds:
        doc = col.find_one({"content_hash": content_hash})
        if doc:
            status = doc.get("processing_status")
            if status in ("COMPLETED", "PHASE1_COMPLETED"):
                logger.info("Concurrent processing reached status=%s for content_hash=%s", status, content_hash)
                return doc
            if status == "FAILED":
                logger.warning("Concurrent processing failed for content_hash=%s", content_hash)
                return None
            if status == "PROCESSING" and _lock_age_seconds(doc) > LOCK_TTL_S:
                logger.warning(
                    "Lock for content_hash=%s is stale (no heartbeat) -- not waiting it out",
                    content_hash,
                )
                return None
        time.sleep(poll_interval)

    logger.warning("Timed out waiting for concurrent processing of content_hash=%s", content_hash)
    return None


def save_phase1_cache(
    content_hash: str,
    extracted_result: Dict[str, Any],
    pipeline_version: str = "v1"
) -> None:
    """Stores a progressive Phase 1 AI extraction result in the cache collection."""
    col = get_cache_collection()
    now_str = datetime.now(timezone.utc).isoformat()
    col.update_one(
        {"content_hash": content_hash},
        {
            "$set": {
                "processing_status": "PHASE1_COMPLETED",
                "extracted_result": extracted_result,
                "pipeline_version": pipeline_version,
                "updated_at": now_str,
            }
        },
        upsert=True
    )
    logger.info("Saved PHASE1_COMPLETED AI extraction result for content_hash=%s", content_hash)


def save_completed_cache(
    content_hash: str,
    extracted_result: Dict[str, Any],
    pipeline_version: str = "v1"
) -> None:
    """Stores a successful AI extraction result in the cache collection."""
    col = get_cache_collection()
    now_str = datetime.now(timezone.utc).isoformat()
    col.update_one(
        {"content_hash": content_hash},
        {
            "$set": {
                "processing_status": "COMPLETED",
                "extracted_result": extracted_result,
                "pipeline_version": pipeline_version,
                "updated_at": now_str,
            }
        },
        upsert=True
    )
    logger.info("Saved COMPLETED AI extraction result for content_hash=%s", content_hash)



def mark_cache_failed(content_hash: str, error_message: str) -> None:
    """Updates cache record to FAILED so future submissions can retry."""
    col = get_cache_collection()
    now_str = datetime.now(timezone.utc).isoformat()
    col.update_one(
        {"content_hash": content_hash},
        {
            "$set": {
                "processing_status": "FAILED",
                "error_message": error_message,
                "updated_at": now_str,
            }
        },
        upsert=True
    )
    logger.info("Marked cache FAILED for content_hash=%s: %s", content_hash, error_message)
