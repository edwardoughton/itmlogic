# Genoa · Competitive Intelligence

Scope: where Genoa sits relative to the broadcast RF tooling landscape an
applicant or consulting engineer is likely to evaluate today (2026).
Honest about gaps. No marketing language.

## 1. The landscape

The tools a typical FCC broadcast-engineering shop actually uses fall in
five buckets:

1. **V-Soft** — *Probe* (FM contour / interference), *AM-Pro 2* (AM
   directional + skywave), *Communications*, *FMCommander* / *CONTOUR*
   bundles.  Desktop Windows.  Industry-standard for FCC filings.
2. **Hatfield & Dawson-style consulting packages** — internal tooling
   (often unpublished or per-firm), heavy on PE-stamped exhibits,
   §73.182 AM night, §73.215 contour-protection, terrain studies,
   tower-detuning.  Output = bound PE-sealed exhibit.
3. **FCC public tools** — *AM Query*, *FM Query*, *TV Query*, *LMS*
   public filings.  Reference data and verification, not engineering
   computation.
4. **REC Networks** — *MyLPFM*, *FCC Channel Search*, *LPFM Spacer*,
   *NCE Eligibility*.  Free / cheap web tools, FM/LPFM-focused, very
   strong on regulatory edge cases (mutually exclusive applications,
   Tribal priority, NCE point system).
5. **Standard consulting workflow** — engineer-in-Excel + Probe + ArcGIS
   + Word.  Slow, expensive, hand-stitched, not reproducible.

## 2. Feature matrix

Legend: `Yes` = shipping, `Partial` = present but gated/limited,
`No` = not in product, `—` = N/A.

| Capability | Genoa | V-Soft Probe / Communications | H&D-style consult package | FCC AM Query / FM Query | REC tools (MyLPFM etc.) | Excel + Probe + ArcGIS |
|---|---|---|---|---|---|---|
| Filing-grade FCC math (§73.333 F(50,50), §73.313 HAAT, §73.187, §73.207, §73.215, §73.525) | Yes — deterministic JS engine, curve-dataset SHA-256 pinned | Yes — industry default | Yes — usually built on Probe / in-house | No — lookup only | Partial — FM spacing + LPFM | Yes (via Probe) |
| AM groundwave (§73.184), skywave (§73.190 Fig. 2 / Berry-1968) | Yes — `engine/am/groundwave.js`, `engine/am/skywave.js` | Yes — AM-Pro 2 | Yes — usually AM-Pro 2 or in-house | No | No | Partial |
| AM night NIF / §73.182 RSS (per-azimuth, per-pair) | Yes — `engine/am/nightInterference.js`, Appendix F-1/F-2/F-3 | Yes — AM-Pro 2 | Yes | No | No | No |
| AM directional pattern designer (theoretical → standard pattern, §73.150 / §73.152) | Yes — `engine/pattern/am_da_synthesizer.js`, `AmDaDesigner.jsx` | Yes — AM-Pro 2 / AM Pattern Optimizer | Yes — typically AM-Pro 2 + hand iteration | No | No | No |
| §73.99 PSRA / PSSA reduced-power authorization | Yes — `engine/am/psraPower.js`, Appendix G-1/G-2/G-3 | Partial — table-driven | Partial — usually hand-computed | No (window only) | No | No |
| Replay determinism (engine SHA + curve dataset SHA + signature in every exhibit) | Yes — `engine/signature.js`, `engine/buildAttestation.js`; same inputs → same outputs forever | No — proprietary build, no published replay contract | No | — | No | No |
| Advisory evidence layer (terrain + SDR + identity, clearly separated from filing math) | Yes — Layer 2 of the architecture, isolated from Layer 1 engine | No — terrain is mixed into the calculation | Varies per firm | No | No | No |
| Independent AM physics cross-check (NEC / SOMNEC2D) | Yes (Appendix H, advisory only) — `evidence/amPhysicsClient.js`, marked non-authoritative | No | Sometimes (4NEC2 in-house) | No | No | No |
| Environmental RF / §1.1310 OET-65 MPE | Partial — `engine/regulatory/oet65.js`, generic MPE; no rooftop / co-location occupancy model yet | Yes — V-Soft RF-Map | Yes — usually in-house | No | No | Partial |
| SDR observability / measurement evidence (SigMF, calibrated captures) | Yes (advisory) — `genoa-measurement-sidecar`, SigMF-pinned, EAS audibility | No | Rare | No | No | No |
| Cloud / browser-native | Yes — single-page UI, REST API, n8n-automatable | No — desktop Windows | No — desktop / firm intranet | Yes (read-only) | Yes | No |
| Desktop install | No — by design | Yes | Yes | — | — | Yes |
| PE seal / certification flow inside the exhibit | Yes — `PeCertifyDialog.jsx`, `peCertification.js`, stamp lands on `exhibit.pe_certification` and the cover/Appendix D | No — engineer signs after export | Yes — but manual | No | No | No |
| Build attestation (every PDF carries engine SHA + curve dataset SHA + git hash) | Yes — `engineeringReport/sections/buildAttestation.js` | No | No | — | No | No |
| Exhibit diff / move-in / what-if | Yes — `engine/exhibitDiff.js`, `ExhibitDiffPanel.jsx` | Partial | Manual | No | No | Manual |
| Peer / comparable facilities benchmarking | Yes — `engine/comparableFacilities.js` | No | Manual | No | No | Manual |
| Parameter sweep ("find best ERP/HAAT") | Yes — `engine/parameterSweep/`, `SweepPanel.jsx` | Partial | Manual | No | Partial (Channel Search) | Manual |
| FM channel / allotment search | Partial — `engine/allotmentSearch.js`, FM-only, no spectrum-wide MX engine | Yes — Probe / Channel Search | Yes | Partial (FM Query) | Yes — Channel Search | Manual |
| Short-spacing showing (§73.215) | Yes — `engine/regulatory/section_73_215.js`, `ShortSpacingShowingPanel.jsx` | Yes | Yes | No | No | Manual |
| LMS filing package export | Yes — `exports/lmsFiling/` | Partial | Manual | — | No | Manual |

## 3. Honest gaps

Genoa does not currently do these things; pretending otherwise damages
credibility with the engineering audience:

- **No DTV / ATSC 3.0.**  No §73.622, no DTV interference, no
  *de minimis* analysis, no NextGen-TV repack tooling.  V-Soft and H&D
  cover this; Genoa does not yet.
- **No spectrum-wide allotment search.**  `engine/allotmentSearch.js`
  evaluates a specified channel; it does not enumerate every available
  channel in a market the way Probe's *Allocation Studies* or REC's
  *FCC Channel Search* do.
- **No microwave / studio-transmitter-link (STL) / point-to-point
  Part 101.**  No path-budget tool, no rain-fade margin, no §101
  coordination database.
- **No DRM / HD Radio digital-sideband interference.**  AM 10 kHz IBOC
  masks and FM digital sidebands are not modeled.
- **No allotment / Table-of-Allotments rule-making support.**  No
  §1.420 petition tooling.
- **No population-overlap engine for FM MX comparative hearings**
  beyond a single facility's covered population; comparative analysis
  across mutually-exclusive applicants is manual.
- **No NCE point-system scoring** (REC's strongest area).
- **No tower-detuning / re-radiation field study tooling**, beyond
  flagging proximate ASR towers via the FAA OE sidecar.
- **Environmental RF is rule-text-grade, not site-survey-grade.**
  `oet65.js` produces MPE percentages, not full §1.1307(b) categorical
  exclusion worksheets with rooftop occupancy classes.
- **No FM IBOC / FM digital coverage**, no §73.404 considerations.

These are tracked in `PRODUCT_GAPS.md` with priority.

## 4. Where Genoa wins (and the audience that cares)

These differentiators are unique-to-Genoa or rare in the landscape, and
land best with consulting engineers preparing PE-sealed exhibits and
with broadcast groups doing repeated what-if studies.

1. **Replay determinism.**  Pin the curve dataset SHA-256 and the
   engine SHA, and the exhibit is reproducible byte-for-byte.  No other
   tool in the matrix publishes this contract.
2. **Cover page carries SHAs.**  Reviewers can verify build identity
   without trusting the vendor.  See `sections/cover.js` and
   `sections/buildAttestation.js`.
3. **Three explicit layers (Engine / Evidence / Narrative)** with hard
   isolation rules.  AI never calculates.  Terrain is advisory.  Filing
   math is the deterministic engine alone.
4. **Independent AM physics evidence (SOMNEC2D) as advisory cross-check
   in Appendix H** — useful for AM-DA designs where reviewers want a
   second engine.
5. **AM-night NIF stack** is filing-grade and presented per-azimuth
   (Appendix F-1), per-pair (F-2), and as a polar plot (F-3).
6. **AM DA designer** ties theoretical → standard pattern → §73.152
   monitor points → operator-hosted SOMNEC2D, all in one workbench
   panel (`AmDaDesigner.jsx`).
7. **§73.99 PSRA/PSSA orchestrator** — most shops still hand-compute
   these; Genoa has a deterministic per-pair authorization engine
   (`psraPssaOrchestrator.js`).
8. **API-first + n8n-automatable.**  Batch jobs, what-if matrices,
   move-in studies all scriptable.
9. **Build attestation in every PDF.**  No competitor ships this.
10. **PE certification stamp is inside the exhibit graph**, not glued
    on at the end.  Stamps land on `exhibit.pe_certification` and the
    cover/Appendix D render reflects them.

## 5. Where each competitor still wins

Stating this plainly is part of the engineering pitch — engineers
distrust tools that claim no peers.

- **V-Soft Probe** — twenty-plus years of acceptance at the Media
  Bureau, DTV coverage, allocation search across the FM band, mature
  microwave/STL tooling, AM-Pro 2's pattern library.
- **Hatfield & Dawson-style packages** — institutional trust, PE
  signatures from named engineers reviewers recognize, white-glove
  exhibit prep, novel-edge-case experience.
- **FCC AM Query / FM Query** — authoritative source of facility
  truth.  Genoa caches and resolves against these but does not replace
  them.
- **REC tools** — LPFM and NCE work, MX-application tooling, community
  / Tribal priority scoring, free for applicants.
- **Excel + Probe + ArcGIS** — incumbent muscle memory; replacing it is
  a workflow problem, not a math problem.

## 6. Positioning sentence

> Genoa is the cloud-native, evidence-aware, reproducible successor to
> ComStudy-style RF planning tools — filing-grade FCC math, advisory
> evidence kept honest in a separate layer, and a build attestation on
> every exhibit so a reviewer can verify what was computed and how.
