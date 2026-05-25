# Genoa · Five-Minute Demo Script

Audience: broadcast consulting engineer, station group chief engineer,
or a Media Bureau-experienced reviewer.  Tone: matter-of-fact, no
hand-waving.

Goal in five minutes: convince the engineer that Genoa is a real
engineering instrument — filing-grade math, deterministic replay,
advisory evidence kept separate, PE-stamped exhibit at the end.

The script below builds on the earlier V-Soft sales-engineer pass.
Times are walking-clock; every click and every spoken phrase is exact.

---

## 0:00 — Land on the product

URL bar: `https://genoaiq.com`
Action: hit Enter.  Login dialog appears.
Action: paste demo creds, click **Sign in**.
Phrase (spoken, slow): *"This is Genoa.  Cloud-native, filing-grade,
ComStudy successor.  Browser only.  No install."*

Wait for `/api/auth/me` to resolve and the workbench rail to mount.
The rail groups tabs into **Exhibit / Studies / AM / Filing / System**.

## 0:15 — Station search

Action: in the top **Station** search box, type `KSLX`.
Wait for debounce.  Pick **KSLX-FM · 100.7 · facility 11282** from the
dropdown.

What just happened, said aloud:
*"The station was resolved against the FCC FM Query via the upstream
ZeroTrustRadio cache.  The facility class, ERP, HAAT, coordinates, and
antenna height all populated from the official LMS record.  The
provenance chip on the class field says 'fcc-amq' — that's the source
of truth, not a number I typed."*

Action: click **Compute exhibit** (`HardwareButton` in the right rail).

The music phase flips to `compute` and the **My Flame** track starts;
status bar reads *"Computing F(50,50) radials…"*.  Compute time is
roughly 90 seconds — fill it with the next beat.

## 1:00 — Cover page SHAs (while compute runs)

Action: click the **Exports** tab → **Open last exhibit PDF (cached
sample)** so the audience can see a cover page without waiting on the
live render.

Point at the identification block on the cover page.

Phrase: *"Two SHAs.  The first is the engine SHA — the git commit of
the deterministic JavaScript engine that produced these numbers.  The
second is the curve dataset SHA-256 — the §73.333 F(50,50) curves and
the §73.184 groundwave curves, pinned by content hash.  Any reviewer
with the same two SHAs can re-run this exhibit and get the same
numbers, byte for byte.  No other product in the broadcast space
publishes this contract."*

When the live compute finishes (`computing → false`), the workbench
auto-switches to the **FCC method** tab.

## 2:00 — Visual Summary

Action: click the **Validation** tab and scroll to the **Visual
Summary** card (it is rendered both on screen and as
`sections/visualSummary.js` in the PDF).

Phrase: *"This is the at-a-glance pass/fail surface.  Filing
readiness gauge.  Contour areas in km².  HAAT per radial.  Warning
console — every structured warning the engine emitted, including
SIDECAR_UNAVAILABLE if terrain didn't load."*

Hover the **Filing readiness gauge**.  It is a green ring iff:
- curve dataset is validated (no `CURVE_VALIDATION_MISSING`),
- no §73.207 / §73.215 violations,
- terrain was applied or explicitly flagged advisory,
- engine signature is present.

Phrase: *"If any of those fail, the gauge is amber or red and the
exhibit will not export as filing-grade.  This is the dashboard a
chief engineer actually looks at."*

## 2:45 — AM DA Designer · null placement

Action: switch the preset to **AM directional sample** (or load the
KSLX cousin AM station from the search box).  Click the **AM
designer** tab (left rail, **AM** group).

The `AmDaDesigner.jsx` panel renders the theoretical pattern, the
standard pattern per §73.150, and a draggable null marker.

Action: drag the deep null azimuth from its current bearing onto a
co-channel interferer's azimuth shown in the per-pair table.

Phrase: *"The pattern is synthesized from the towers, currents,
phases, and spacings — `engine/pattern/am_da_synthesizer.js`.  As I
move this null, the §73.182 NIF radius on the polar plot below
updates in real time.  This is the workflow that today is two
engineers, AM-Pro 2, and a week."*

Watch the **AM Night NIF preview** (stacked below) and the
**§73.99 Sun Authority** panel — both are sections of the same
designer panel by design, so the rail doesn't bloat.

## 3:30 — Appendix H · SOMNEC2D advisory cross-check

Action: open the PDF preview pane → jump to **Appendix H**.

Phrase: *"This is the operator-hosted SOMNEC2D sidecar — an
independent NEC-based AM physics engine running outside the Genoa
deterministic core.  It is marked **advisory**.  It cannot change a
single number in the filing.  It exists so a reviewer can see two
independent engines disagree by less than X percent before signing.
If the sidecar is not configured, this appendix is absent and the
exhibit is unaffected."*

Point at the "Engine: somnec2d" row and the explicit "advisory only"
banner.

Phrase: *"This is the difference between an evidence layer and a
calculation layer.  Genoa keeps them in separate physical files."*

## 4:15 — Appendix G · §73.99 + Appendix F-3 polar plot

Action: page to **Appendix G** in the PDF preview.

Phrase: *"§73.99 PSRA / PSSA reduced-power authorization, per-pair, in
local time.  G-1 is the daily window.  G-2 is the PSSA 50% SS-1
allowed power per interfering pair.  G-3 is the PSRA 10% SS-2 case.
Most shops hand-compute these from the rule text.  Genoa's
`psraPssaOrchestrator.js` does it deterministically and exports it as
a filing-ready table."*

Page to **Appendix F-3**.

Phrase: *"And this is the NIF contour as a polar plot.  Every azimuth,
every interferer, the RSS per §73.182(k).  F-1 is the per-azimuth
radius table; F-2 is the interferer pool; F-3 is what the engineer
actually wants to see."*

## 4:45 — Build attestation + PE seal

Action: jump to the **Build attestation** section at the end of the
PDF (`sections/buildAttestation.js`).

Phrase: *"Every Genoa exhibit ends with a build attestation block —
engine SHA, curve dataset SHA, git hash of the running container, node
version, and timestamp.  No competitor in the broadcast tool space
ships this.  A reviewer who archives the PDF can later verify that
this exact build produced this exact exhibit."*

Action: click **PE certify** in the rack.  `PeCertifyDialog.jsx`
opens.  Enter PE number, state, expiration.  Click **Apply seal**.

The stamp lands on `exhibit.pe_certification`; the cover page and
Appendix D update; the PDF re-renders with the seal on the cover.

Phrase: *"The PE seal is inside the exhibit graph, not glued on at
the end.  It is part of what gets hashed.  It is part of what replays.
That's how you ship a filing-grade exhibit in five minutes that an
engineer is willing to sign."*

End.  Total runtime ~5:00.

---

## Notes for the demo operator

- Pre-warm the sample exhibit cache (`node scripts/sample-exhibit.js
  --station kslx`) before the call so the **Open last exhibit PDF**
  shortcut at 1:00 is instant.
- Confirm `AM_PHYSICS_SIDECAR_URL` is configured before the run — if
  not, Appendix H will be absent and the 3:30 beat collapses.
- Mute the **studyMusic** track for screenshare audiences who do not
  want Bobby Caldwell under their call (`muted=true` toggle in the
  top rack).
- If compute is slow, fill 1:00–2:00 with the **Service health**
  panel — it shows terrain / measurement / identity sidecar status,
  which makes the layered architecture concrete.
- Do not narrate the AI.  `narrative.ai_used` is `false`.  Saying "AI
  wrote this" is wrong and will lose the engineering audience.
