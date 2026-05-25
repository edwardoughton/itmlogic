#!/usr/bin/env python3
"""
Genoa ASR sidecar — Tier-4 lookup bridge.

Tier hierarchy (per operator-locked policy):
  Tier 1 — FCC ULS r_tower.zip bulk DB (always primary; FCC-official)
  Tier 2 — reserved for future independent ASR mirror (TBD)
  Tier 3 — ZTR rich-station _tower passthrough (handled in main API)
  Tier 4 — this bridge: REC Networks → radio-locator chain

Modeled on nec_bridge.py: invoked as a subprocess from server.js,
takes an ASR registration number on argv, prints exactly one JSON
line on stdout, exits 0.

Tier-4 has THREE providers attempted in order, until one succeeds:

  4a — REC Networks API (api.recnet.net/towerinfo)
       Requires REC_API_KEY (free, request from recnet.com/api).
       JSON response, fastest.  Preferred when configured.

  4b — REC Networks /towerfind web page via cloudscraper
       Free, slower, occasionally rate-limited.  Defeats Cloudflare /
       Akamai by mimicking a real browser TLS fingerprint.

  4c — radio-locator.com tower lookup
       Independent third-party broadcast database; last-resort
       fallback if REC is unreachable.

Output schema matches what genoa-asr-sidecar's by-number tier-1
endpoint returns (rowToRecord), so the calling code is uniform.
Sets `source_tier: 4`, `source_subtier: '4a'|'4b'|'4c'` for
provenance.
"""
import os
import sys
import json
import time
import re

REC_API_KEY = os.environ.get("REC_API_KEY", "").strip()


def emit(obj):
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()


def fail(reason, attempts=None):
    emit({
        "available": False,
        "source": "asr-sidecar-tier4",
        "source_tier": 4,
        "error": reason,
        "attempts": attempts or [],
    })
    sys.exit(0)


def to_float(s):
    if s is None: return None
    try:
        m = re.search(r"-?\d+(?:\.\d+)?", str(s))
        return float(m.group(0)) if m else None
    except Exception:
        return None


def ft_to_m(s):
    f = to_float(s)
    return round(f * 0.3048, 2) if f is not None else None


def parse_dms(s):
    """ULS / REC render lat/lon as e.g. '40-44-54.4 N' or '40.748444'.
    Accept either."""
    if s is None: return None
    s = str(s).strip()
    m = re.match(
        r"\s*(-?\d+)\s*[\-°]\s*(\d+)\s*[\-']\s*(\d+(?:\.\d+)?)\s*[\"']?\s*([NSEW])",
        s,
    )
    if m:
        d, mi, se, hemi = m.groups()
        deg = abs(float(d)) + float(mi) / 60 + float(se) / 3600
        if hemi in ("S", "W") or float(d) < 0: deg = -deg
        return deg
    return to_float(s)


# ─── Tier 4a: REC API (api.recnet.net/towerinfo) ─────────────────────
def tier_4a_rec_api(asr, scraper, attempts):
    if not REC_API_KEY:
        attempts.append({"subtier": "4a", "skipped": "REC_API_KEY not configured"})
        return None
    url = f"https://api.recnet.net/towerinfo/?asrn={asr}&key={REC_API_KEY}"
    started = time.time()
    try:
        r = scraper.get(url, timeout=10)
        attempts.append({"subtier": "4a", "url": "api.recnet.net/towerinfo",
                         "http": r.status_code, "ms": int((time.time()-started)*1000)})
        if r.status_code != 200:
            return None
        d = r.json()
    except Exception as e:
        attempts.append({"subtier": "4a", "error": str(e)[:200]})
        return None
    if d.get("status", {}).get("error") == "error":
        return None
    # REC's tower payload shape (per recnet.com/api-towerinfo doc):
    # {"asrn": "...", "fcc_registration_number": "...", ...}
    t = d.get("tower") or d
    return {
        "available":            True,
        "source":               "rec-networks-api",
        "source_tier":          4,
        "source_subtier":       "4a",
        "asr_number":           str(t.get("asrn") or asr),
        "status":               t.get("status"),
        "owner":                t.get("entity") or t.get("owner") or t.get("registrant"),
        "owner_frn":            t.get("frn") or t.get("fcc_registration_number"),
        "latitude_deg":         to_float(t.get("lat") or t.get("latitude")),
        "longitude_deg":        to_float(t.get("lon") or t.get("longitude")),
        "overall_height_m":     ft_to_m(t.get("oahaag") or t.get("height_agl")),
        "overall_height_amsl_m": ft_to_m(t.get("oahamsl") or t.get("height_amsl")),
        "ground_elevation_m":   ft_to_m(t.get("ground") or t.get("ground_elevation")),
        "structure_type":       t.get("type"),
        "faa_study_number":     t.get("faasn") or t.get("faa_study_number"),
        "painting_requirement": t.get("paint"),
        "lighting_requirement": t.get("light") or t.get("lighting"),
        "structure_address":    t.get("address"),
        "structure_city":       t.get("city"),
        "structure_state":      t.get("state"),
        "fetched_at":           time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "endpoint":             "https://api.recnet.net/towerinfo",
    }


# ─── Tier 4b: REC web /towerfind scrape (no API key) ─────────────────
def tier_4b_rec_web(asr, scraper, attempts):
    """Submit asrnum to recnet.com/towerfind, parse the rendered detail."""
    started = time.time()
    try:
        r = scraper.post(
            "https://recnet.com/towerfind",
            data={"asrnum": str(asr)},
            timeout=12,
            headers={"Referer": "https://recnet.com/towerfind"},
        )
        attempts.append({"subtier": "4b", "url": "recnet.com/towerfind",
                         "http": r.status_code, "ms": int((time.time()-started)*1000)})
        if r.status_code != 200:
            return None
        body = r.text
    except Exception as e:
        attempts.append({"subtier": "4b", "error": str(e)[:200]})
        return None
    # If the form rendered tower data, the page contains the ASR number
    # near the matched record.  Without the rendered match, the form
    # just re-shows itself.
    if str(asr) not in body:
        return None
    try:
        from bs4 import BeautifulSoup
    except ImportError:
        return None
    soup = BeautifulSoup(body, "html.parser")
    fields = {}
    for row in soup.find_all("tr"):
        cells = row.find_all(["td", "th"])
        for i in range(0, len(cells) - 1, 2):
            label = cells[i].get_text(" ", strip=True).rstrip(":").lower()
            value = cells[i + 1].get_text(" ", strip=True)
            if label and value and label not in fields:
                fields[label] = value

    def grab(*labels):
        for k in labels:
            v = fields.get(k)
            if v and v not in ("", "-", "N/A"): return v
        return None

    return {
        "available":            True,
        "source":               "rec-networks-web",
        "source_tier":          4,
        "source_subtier":       "4b",
        "asr_number":           str(asr),
        "status":               grab("status", "registration status"),
        "owner":                grab("registrant", "owner", "entity"),
        "latitude_deg":         parse_dms(grab("latitude", "lat", "n latitude")),
        "longitude_deg":        parse_dms(grab("longitude", "lon", "w longitude")),
        "overall_height_m":     ft_to_m(grab("overall height above ground", "oah agl")),
        "overall_height_amsl_m": ft_to_m(grab("overall height above mean sea level", "oah amsl")),
        "ground_elevation_m":   ft_to_m(grab("ground elevation")),
        "structure_type":       grab("structure type", "type"),
        "faa_study_number":     grab("faa study number", "aeronautical study number"),
        "painting_requirement": grab("painting"),
        "lighting_requirement": grab("lighting"),
        "structure_address":    grab("street address", "address"),
        "structure_city":       grab("city"),
        "structure_state":      grab("state"),
        "fetched_at":           time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "endpoint":             "https://recnet.com/towerfind",
    }


# ─── Tier 4c: radio-locator.com fallback ─────────────────────────────
def tier_4c_radio_locator(asr, scraper, attempts):
    """Best-effort radio-locator scrape.  Their public tower lookup may
    not be exposed under a stable URL; we try the most common."""
    started = time.time()
    candidates = [
        f"https://radio-locator.com/cgi-bin/asr?asr={asr}",
        f"https://radio-locator.com/info/tower?asr={asr}",
        f"https://radio-locator.com/towers/{asr}",
    ]
    last_status = None
    for url in candidates:
        try:
            r = scraper.get(url, timeout=8, allow_redirects=True)
            last_status = r.status_code
            if r.status_code == 200 and str(asr) in r.text and "404" not in r.text[:200]:
                # Found a render — surface the URL even if we can't
                # parse all fields; this is best-effort tier-3c.
                attempts.append({"subtier": "4c", "url": url, "http": 200,
                                 "ms": int((time.time()-started)*1000)})
                return {
                    "available":      True,
                    "source":         "radio-locator-web",
                    "source_tier":    4,
                    "source_subtier": "4c",
                    "asr_number":     str(asr),
                    "fetched_at":     time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                    "endpoint":       url,
                    "note":           "tier-4c surfaces the lookup URL only; field extraction not implemented",
                }
        except Exception as e:
            last_status = f"err:{e}"
    attempts.append({"subtier": "4c", "tried": candidates, "last_status": str(last_status)})
    return None


def main():
    if len(sys.argv) < 2:
        fail("usage: asr_html_bridge.py <asr_number>")
    asr = sys.argv[1].strip()
    if not asr.isdigit() or len(asr) > 10:
        fail(f"asr_number must be numeric (got {asr!r})")

    try:
        import cloudscraper
    except ImportError as e:
        fail(f"cloudscraper not installed: {e}")

    scraper = cloudscraper.create_scraper(
        browser={"browser": "chrome", "platform": "linux", "desktop": True}
    )
    scraper.headers.update({
        "Accept": "text/html,application/xhtml+xml,application/json,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Cache-Control": "no-cache",
        "User-Agent": "Mozilla/5.0 genoa-asr/0.1 (chelstein/itmlogic)",
    })

    attempts = []

    # 4a → 4b → 4c chain
    for fn in (tier_4a_rec_api, tier_4b_rec_web, tier_4c_radio_locator):
        result = fn(asr, scraper, attempts)
        if result:
            result["attempts"] = attempts
            emit(result)
            return

    fail(f"all tier-4 providers exhausted for ASR {asr}", attempts)


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception as e:
        fail(f"unhandled: {e}")
