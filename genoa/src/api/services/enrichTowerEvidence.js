// Shared tower-evidence enrichment.
//
// Enriches an exhibit with evidence.asr / evidence.faa_oe /
// tower_compliance just before the engineering report or LMS filing
// package is rendered.  The compute orchestrator (exhibitService.js)
// only attaches evidence.asr when an asr_number is supplied OR when
// the ZTR rich-station response carried tower data.  Many exhibits
// fall through both paths — the operator typed only call + facility_id
// + coords, ZTR didn't have _tower data — and the Tower Study /
// LMS Section III 3E rows then render EVIDENCE MISSING despite the
// FCC ULS bulk DB knowing the tower from its lat/lon alone.
//
// This module fills that gap by calling the asrClient's lat/lon
// proximity lookup (which now hits the genoa-asr-sidecar with a 1km
// → 5km → 25km radius ladder), then chains FAA OE/AAA fetch (when
// the resolved ASR carries faa_study_number) and rules-derived tower
// compliance (§17.21 / §17.23 / AC 70/7460-1L).
//
// All three steps are fail-soft — a Socrata outage or sidecar
// unreachability simply leaves the rows as-is and the renderer
// emits its own "deferred" placeholder.
//
// MUTATES the supplied exhibit in place.  The exhibit isn't persisted
// downstream of these routes, so this is the simplest way to make the
// new evidence visible to every section builder that already reads
// exhibit.evidence.asr / .faa_oe / exhibit.tower_compliance.

export async function enrichTowerEvidence(exhibit, log = console){
  if (!exhibit || typeof exhibit !== 'object') return;
  exhibit.evidence = exhibit.evidence || {};

  // ASR by lat/lon proximity — only when not already attached.
  if (!exhibit.evidence.asr?.available){
    const lat = Number(exhibit.station_inputs?.lat);
    const lon = Number(exhibit.station_inputs?.lon);
    if (Number.isFinite(lat) && Number.isFinite(lon)){
      try {
        const { makeAsrClient, checkAsrAgainstApplication } = await import('../../evidence/asrClient.js');
        const asrClient = makeAsrClient();
        if (!asrClient){
          log.warn?.('[enrichTowerEvidence] asrClient is null (no ASR_SIDECAR_URL / ZTR / Socrata configured)');
        } else {
          // Default ladder is 1km → 5km → 25km → 100km → 200km inside getByLocation.
          // Operator can pin a single radius via ASR_LOCATION_RADIUS_M.
          const radius_m = process.env.ASR_LOCATION_RADIUS_M
            ? Number(process.env.ASR_LOCATION_RADIUS_M)
            : null;
          log.info?.(`[enrichTowerEvidence] asr getByLocation lat=${lat} lon=${lon} radius_m=${radius_m || 'ladder'}`);
          const byLoc = await asrClient.getByLocation({ lat, lon, radius_m });
          log.info?.(`[enrichTowerEvidence] asr result available=${byLoc.available} source=${byLoc.source || '-'} asr=${byLoc.asr_number || '-'} dist=${byLoc.distance_m ?? '-'} err=${byLoc.error || '-'}`);
          if (byLoc.available){
            const asrResult = checkAsrAgainstApplication({
              asr: byLoc,
              application: {
                asr_number:            exhibit.station_inputs?.asr_number || null,
                lat, lon,
                overall_height_m:      exhibit.station_inputs?.overall_height_m || null,
                overall_height_amsl_m: exhibit.station_inputs?.overall_height_amsl_m || null
              }
            });
            exhibit.evidence.asr = asrResult;
          } else {
            // Surface the search-ladder + final error on the exhibit so
            // Tower Study can render NOT_REGISTERED with citation
            // instead of a blank "no record attached" message.
            exhibit.evidence.asr_attempt = {
              ok:           false,
              source:       byLoc.source,
              error:        byLoc.error,
              search_ladder: byLoc.search_ladder
            };
          }
        }
      } catch (err){
        log.warn?.('[enrichTowerEvidence] asr threw:', err?.message || err);
      }
    }
  }

  // FAA OE/AAA by Aeronautical Study Number on the ASR record.
  if (!exhibit.evidence.faa_oe?.available
      && exhibit.evidence.asr?.faa_study_number){
    try {
      const { makeFaaOeClient, checkFaaAgainstAsr } = await import('../../evidence/faaOeClient.js');
      const faaClient = makeFaaOeClient();
      if (faaClient){
        const faa = await faaClient.getByStudyNumber(exhibit.evidence.asr.faa_study_number);
        if (faa.available || faa.error){
          exhibit.evidence.faa_oe = checkFaaAgainstAsr({ faa, asr: exhibit.evidence.asr });
        }
      }
    } catch { /* fail-soft */ }
  }

  // ZTR rich-station tower-height backfill.  When the operator didn't
  // type a tower height AND the asr-sidecar / FAA OE didn't return one,
  // pull structure_height_m / amsl_m / asrn from ZTR's
  // /api/broadcast/stations?callsign=X record.  ZTR carries these fields
  // for almost every FCC broadcast license, sourced from the FCC's own
  // FMQ/AMQ feeds.  Without this, the §17.21/§17.23 rules engine has no
  // height to evaluate and Section III·3E renders EVIDENCE MISSING.
  // Fail-soft: ZTR unreachable / no record / no height → operator must
  // supply tower height, no change to behavior.
  if (!Number.isFinite(Number(exhibit.station_inputs?.overall_height_m))){
    const ztrBase = process.env.ZERO_TRUST_RADIO_READONLY_URL;
    const call    = exhibit.station_inputs?.call;
    if (ztrBase && call){
      try {
        const u = `${ztrBase.replace(/\/$/, '')}/api/broadcast/stations?callsign=${encodeURIComponent(call)}`;
        const r = await fetch(u, { signal: AbortSignal.timeout(8000) });
        if (r.ok){
          const j = await r.json();
          const row = (j?.rows || []).find(s =>
            String(s?.callsign || '').toUpperCase() === String(call).toUpperCase());
          if (row){
            const h    = Number(row.structure_height_m);
            const amsl = Number(row.amsl_m);
            const asrn = row.asrn || row.asr_number || null;
            if (Number.isFinite(h) && h > 0){
              exhibit.station_inputs.overall_height_m = h;
              log.info?.(`[enrichTowerEvidence] ztr-backfill structure_height_m=${h} for ${call}`);
            }
            if (Number.isFinite(amsl) && amsl > 0
                && !Number.isFinite(Number(exhibit.station_inputs.overall_height_amsl_m))){
              exhibit.station_inputs.overall_height_amsl_m = amsl;
            }
            if (asrn && !exhibit.station_inputs.asr_number){
              exhibit.station_inputs.asr_number = String(asrn);
              log.info?.(`[enrichTowerEvidence] ztr-backfill asr_number=${asrn} for ${call}`);
            }
          } else {
            log.warn?.(`[enrichTowerEvidence] ztr-backfill: no rows for ${call}`);
          }
        } else {
          log.warn?.(`[enrichTowerEvidence] ztr-backfill HTTP ${r.status}`);
        }
      } catch (err){
        log.warn?.('[enrichTowerEvidence] ztr-backfill threw:', err?.message || err);
      }
    }
  }

  // §17.7(c) airport-proximity auto-check.  Pull the list of
  // public-use airports/heliports within 6 nm of the tower from the
  // genoa-faa-airports sidecar so requiredTowerCompliance can run the
  // real distance check instead of trusting an operator-typed
  // near_airport boolean.  Fail-soft: if AIRPORTS_SIDECAR_URL is
  // unset / unreachable, airports_nearby stays null and the legacy
  // boolean still applies.
  let airports_nearby = null;
  {
    const lat = Number(exhibit.station_inputs?.lat);
    const lon = Number(exhibit.station_inputs?.lon);
    if (Number.isFinite(lat) && Number.isFinite(lon)){
      try {
        const { makeAirportClient } = await import('../../evidence/airportClient.js');
        const airportClient = makeAirportClient();
        if (airportClient){
          const r = await airportClient.getAirportsNear({ lat, lon, radius_nm: 6 });
          if (r.available){
            airports_nearby = r.airports;
            log.info?.(`[enrichTowerEvidence] airports_near n=${r.n} radius_nm=6`);
            exhibit.evidence.airports_nearby = airports_nearby;
          } else {
            log.warn?.(`[enrichTowerEvidence] airports_near unavailable: ${r.error}`);
          }
        }
      } catch (err){
        log.warn?.('[enrichTowerEvidence] airport lookup threw:', err?.message || err);
      }
    }
  }

  // Rules-derived tower compliance (lighting + painting per §17.21 /
  // §17.23 / AC 70/7460-1L).  Runs whenever we have a positive
  // overall_height_m — operator-supplied height alone is enough to
  // determine §17.7 notification status, marking style, and lighting
  // style.  When an ASR record is available we layer compareToAsr() on
  // top so the row also captures any height/coords mismatch with the
  // registered tower; otherwise we attach the raw rules verdict so the
  // downstream LMS / engineering-report 3E rows fill from §17 rules
  // instead of rendering EVIDENCE MISSING.
  if (!exhibit.tower_compliance?.applicable){
    const height_agl_m = exhibit.evidence.asr?.overall_height_m
                      ?? exhibit.station_inputs?.overall_height_m
                      ?? null;
    if (Number.isFinite(Number(height_agl_m)) && Number(height_agl_m) > 0){
      try {
        const { requiredTowerCompliance, compareToAsr } =
          await import('../../engine/tower/index.js');
        const compliance = requiredTowerCompliance({
          height_agl_m:   Number(height_agl_m),
          height_amsl_m:  exhibit.evidence.asr?.overall_height_amsl_m
                            ?? exhibit.station_inputs?.overall_height_amsl_m
                            ?? null,
          structure_type: exhibit.station_inputs?.structure_type || 'TOWER',
          near_airport:   !!exhibit.station_inputs?.near_airport,
          airports_nearby
        });
        if (compliance.applicable){
          exhibit.tower_compliance = exhibit.evidence.asr?.available
            ? compareToAsr({ compliance, asr: exhibit.evidence.asr })
            : compliance;
        }
      } catch { /* fail-soft */ }
    }
  }
}
