"""Genoa FCCAM sidecar — FastAPI HTTP wrapper around the FCC's
public-domain Fccam.for skywave program.

ENDPOINTS
  GET  /healthz          → "ok"
  GET  /version          → engine + binary/source SHAs + build_time
  POST /run              → single skywave compute (50% F2 layer)
  POST /run-batch        → vectorized; serializes calls

AUTH
  When FCCAM_API_TOKEN is set in the container env, all endpoints
  except /healthz require Authorization: Bearer <token>.  Same
  pattern the existing fcc-fortran-engine uses.

REPLAY DETERMINISM
  Every /run response carries input_sha256 — a hash over the
  normalized inputs (rounded to FCCAM's input precision: ERP 0.001 kW,
  distance 0.01 km, frequency 1 kHz, latitude 0.001°).  Identical
  inputs produce identical hashes; reviewers can match the hash
  back to the exhibit row and replay the call.

REGULATORY CITATIONS
  - 47 CFR §73.182  — engineering standards of allocation (AM)
  - 47 CFR §73.190  — engineering charts, Figure 2 (50% skywave)
  - 47 CFR §73.190(c) — Wang formula explicitly permitted
  - 17 USC §105     — FCC code is US Government public-domain work
"""

import hashlib
import json
import os
import subprocess
import time
from pathlib import Path
from typing import List, Literal, Optional

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from pydantic import BaseModel, Field, field_validator

APP_ROOT = Path("/app")
FCCAM_BIN = APP_ROOT / "fccam"
FOR_SHA_FILE = APP_ROOT / ".fccam_for_sha256"
BIN_SHA_FILE = APP_ROOT / ".fccam_bin_sha256"

# Built-once when the container starts.
START_TIME = time.time()
START_ISO = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(START_TIME))

API_TOKEN = (os.environ.get("FCCAM_API_TOKEN") or "").strip()
FCCAM_VERSION_LABEL = (os.environ.get("FCCAM_VERSION") or "fccam-wang-1985").strip()


def _read_sha(p: Path) -> Optional[str]:
    try:
        v = p.read_text().strip()
        return v if v and all(c in "0123456789abcdef" for c in v.lower()) and len(v) == 64 else None
    except FileNotFoundError:
        return None


SOURCE_SHA = _read_sha(FOR_SHA_FILE)
BINARY_SHA = _read_sha(BIN_SHA_FILE)


# ---------------------------------------------------------------------------
# auth dependency
# ---------------------------------------------------------------------------

def require_token(authorization: Optional[str] = Header(default=None)):
    if not API_TOKEN:
        return  # auth disabled
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="bearer token required")
    given = authorization.split(" ", 1)[1].strip()
    if given != API_TOKEN:
        raise HTTPException(status_code=401, detail="bad token")


# ---------------------------------------------------------------------------
# input model — matches the Genoa-side client in genoa/src/evidence/fccamClient.js
# ---------------------------------------------------------------------------

class RunRequest(BaseModel):
    erp_kw:        float = Field(..., gt=0, le=50_000, description="ERP in kW (unattenuated)")
    freq_khz:      int   = Field(..., ge=535, le=1705, description="AM carrier in kHz")
    distance_km:   float = Field(..., gt=0, le=8_000)
    midpoint_lat:  float = Field(..., ge=-90, le=90, description="Geographic latitude at the midpoint of the great-circle path")
    percent_time:  int   = Field(50, description="Skywave statistic — 50 (most common) or 10")
    mode:          Literal["field_at_distance", "distance_to_field"] = "field_at_distance"
    field_uv_m:    Optional[float] = Field(None, gt=0, description="Required when mode=distance_to_field")

    @field_validator("percent_time")
    @classmethod
    def _check_percent_time(cls, v: int) -> int:
        if v not in (10, 50):
            raise ValueError("percent_time must be 10 or 50 (FCCAM tabulates only these two)")
        return v

    @field_validator("freq_khz")
    @classmethod
    def _check_freq_grid(cls, v: int) -> int:
        # AM is on a 10-kHz grid in the US.  Reject off-grid values
        # explicitly rather than silently snap.
        if v % 10 != 0:
            raise ValueError(f"freq_khz {v} is not on the US 10-kHz AM grid")
        return v


class RunBatchRequest(BaseModel):
    requests: List[RunRequest] = Field(..., min_length=1, max_length=1024)


# ---------------------------------------------------------------------------
# normalization + hashing
# ---------------------------------------------------------------------------

def _normalize_inputs(r: RunRequest) -> dict:
    """Round each input to FCCAM's stated precision.  Two requests that
    round to the same values are bit-identical to FCCAM, so their
    input_sha256 must be equal.
    """
    return {
        "engine":        "fccam",
        "erp_kw":        round(r.erp_kw, 3),
        "freq_khz":      int(r.freq_khz),
        "distance_km":   round(r.distance_km, 2),
        "midpoint_lat":  round(r.midpoint_lat, 3),
        "percent_time":  int(r.percent_time),
        "mode":          r.mode,
        "field_uv_m":    round(r.field_uv_m, 3) if r.field_uv_m is not None else None,
    }


def _hash_inputs(norm: dict) -> str:
    canonical = json.dumps(norm, separators=(",", ":"), sort_keys=True)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


# ---------------------------------------------------------------------------
# fccam subprocess wrapper
# ---------------------------------------------------------------------------

def _invoke_fccam(norm: dict) -> dict:
    """Single FCCAM compute.  Returns
        { ok, field_uv_m?, distance_km?, flag, stdout, stderr }
    Inputs are written as a stdin block in the format Fccam.for parses.
    Output is parsed from stdout.

    THIS FUNCTION IS DELIBERATELY THIN.  The FCCAM input/output formats
    are fixed by the FORTRAN program; do not preprocess outputs here
    beyond parsing numeric fields, so reviewers can match the stdout
    block in the exhibit to a hand-run of the same program.
    """
    if not FCCAM_BIN.exists():
        return {
            "ok": False,
            "flag": "FCCAM_BIN_MISSING",
            "stdout": "",
            "stderr": f"{FCCAM_BIN} not found — the image was built without Fccam.for",
        }

    # FCCAM stdin block: one line per input, in column-1-formatted
    # Fortran fields.  See Fccam.for header for the exact format the
    # operator-supplied binary expects.  We pipe a minimal namelist-like
    # set of arguments — the FORTRAN program decides what's valid and
    # returns a flag for anything off-grid.
    stdin_payload = (
        f"{norm['mode']}\n"
        f"{norm['erp_kw']:.3f}\n"
        f"{norm['freq_khz']:d}\n"
        f"{norm['distance_km']:.2f}\n"
        f"{norm['midpoint_lat']:.3f}\n"
        f"{norm['percent_time']:d}\n"
        f"{(norm['field_uv_m'] or 0):.3f}\n"
    )

    try:
        proc = subprocess.run(
            [str(FCCAM_BIN)],
            input=stdin_payload,
            capture_output=True,
            text=True,
            timeout=30,
        )
    except subprocess.TimeoutExpired as e:
        return {"ok": False, "flag": "TIMEOUT", "stdout": e.stdout or "", "stderr": str(e)}
    except OSError as e:
        return {"ok": False, "flag": "EXEC_ERROR", "stdout": "", "stderr": str(e)}

    out = proc.stdout or ""
    err = proc.stderr or ""
    if proc.returncode != 0:
        return {
            "ok": False,
            "flag": f"FCCAM_NONZERO_RC_{proc.returncode}",
            "stdout": out, "stderr": err,
        }

    parsed = _parse_fccam_stdout(out, norm["mode"])
    parsed["stdout"] = out
    parsed["stderr"] = err
    return parsed


def _parse_fccam_stdout(stdout: str, mode: str) -> dict:
    """Pulls the numeric result out of FCCAM's stdout.  FCCAM prints
    a banner + a result line like:

        ANSWER: FIELD =  1.234E+02 UV/M   AT 850.0 KM   AT 50%

    The exact wording is set by Fccam.for; the operator confirms the
    parse keys at sidecar bring-up against a few real-station runs.
    We accept either FIELD or DISTANCE depending on mode and return
    {ok: true, field_uv_m | distance_km, flag: None}.
    """
    field_uv_m: Optional[float] = None
    distance_km: Optional[float] = None
    flag: Optional[str] = None
    for raw in stdout.splitlines():
        line = raw.strip()
        if not line:
            continue
        upper = line.upper()
        if "ERROR" in upper or "INVALID" in upper:
            flag = line  # surface the FORTRAN-side flag verbatim
        if "FIELD" in upper and "=" in line:
            tok = _extract_number_after(line, "FIELD")
            if tok is not None:
                field_uv_m = tok
        if "DISTANCE" in upper and "=" in line:
            tok = _extract_number_after(line, "DISTANCE")
            if tok is not None:
                distance_km = tok

    if mode == "field_at_distance":
        ok = field_uv_m is not None
        return {"ok": ok, "field_uv_m": field_uv_m, "flag": flag}
    elif mode == "distance_to_field":
        ok = distance_km is not None
        return {"ok": ok, "distance_km": distance_km, "flag": flag}
    return {"ok": False, "flag": "UNKNOWN_MODE"}


def _extract_number_after(line: str, key: str) -> Optional[float]:
    """Pull the first number that appears after `key=`."""
    idx = line.upper().find(key.upper())
    if idx < 0:
        return None
    rhs = line[idx + len(key):].lstrip()
    if rhs.startswith("="):
        rhs = rhs[1:].lstrip()
    token = ""
    for ch in rhs:
        if ch.isdigit() or ch in ".eE+-":
            token += ch
        else:
            break
    if not token:
        return None
    try:
        return float(token)
    except ValueError:
        return None


# ---------------------------------------------------------------------------
# app
# ---------------------------------------------------------------------------

app = FastAPI(title="genoa-fccam-sidecar", version=FCCAM_VERSION_LABEL)


@app.get("/healthz")
def healthz():
    return {"ok": True, "binary_present": FCCAM_BIN.exists()}


@app.get("/version", dependencies=[Depends(require_token)])
def version():
    return {
        "engine": "fccam",
        "version": FCCAM_VERSION_LABEL,
        "binary_present": FCCAM_BIN.exists(),
        "source_sha256": SOURCE_SHA,   # Fccam.for sha256
        "image_sha256": None,          # Docker image digest — caller fills from registry
        "binary_sha256": BINARY_SHA,   # compiled fccam executable sha256
        "files": {
            "Fccam.for": {"sha256": SOURCE_SHA, "size": _maybe_size(APP_ROOT / "src/Fccam.for")},
        },
        "container_started_at": START_ISO,
        "regulation": "47 CFR §73.190(c) (Wang skywave); §73.182 (AM nighttime allocation)",
        "license_basis": "17 USC §105 (US Government work product, public domain)",
    }


def _maybe_size(p: Path) -> Optional[int]:
    try:
        return p.stat().st_size
    except FileNotFoundError:
        return None


@app.post("/run", dependencies=[Depends(require_token)])
def run(req: RunRequest):
    norm = _normalize_inputs(req)
    input_sha = _hash_inputs(norm)
    result = _invoke_fccam(norm)
    return {
        **result,
        "engine": "fccam",
        "input_sha256": input_sha,
        "inputs": norm,
        "engine_version": FCCAM_VERSION_LABEL,
        "source_sha256": SOURCE_SHA,
    }


@app.post("/run-batch", dependencies=[Depends(require_token)])
def run_batch(batch: RunBatchRequest):
    out = []
    for r in batch.requests:
        norm = _normalize_inputs(r)
        input_sha = _hash_inputs(norm)
        single = _invoke_fccam(norm)
        out.append({
            **single,
            "engine": "fccam",
            "input_sha256": input_sha,
            "inputs": norm,
        })
    n_ok = sum(1 for r in out if r.get("ok"))
    return {
        "ok": n_ok == len(out),
        "n_requests": len(out),
        "n_ok": n_ok,
        "n_failed": len(out) - n_ok,
        "results": out,
        "engine_version": FCCAM_VERSION_LABEL,
        "source_sha256": SOURCE_SHA,
    }
