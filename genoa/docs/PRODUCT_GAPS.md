# Genoa · Product Gaps (Top 15, Impact-Ordered)

A frank list of what Genoa does not do today, ranked by impact on the
audience that matters — consulting engineers preparing filings, and
broadcast groups doing repeated what-if studies.  Each gap is
classified:

- **Fix today** — single-session work, blocks immediate adoption.
- **Fix this week** — multi-day but inside the current architecture.
- **Future moat** — substantial work; turns into a durable advantage if
  shipped.
- **Strategic skip** — out of scope on purpose; document the reason.

The ranking is impact-first, not cost-first.  Sequencing is up to the
roadmap owner; cost is a secondary signal noted in the rationale.

---

### 1. Spectrum-wide FM allotment / channel search

**Class:** Fix this week.
The existing `engine/allotmentSearch.js` evaluates a specified channel
against §73.207 spacing.  It does not enumerate every channel in a
market and rank candidates.  REC's *FCC Channel Search* and Probe's
*Allocation Studies* both do this.  Adding a band-sweep wrapper around
the existing per-channel evaluator is mechanical work and unblocks the
"where can I put a new translator" pitch.

### 2. NCE point-system scoring (§73.7000 et seq.)

**Class:** Future moat.
REC owns this today.  An NCE point-system module — Tribal priority,
established local applicant, technical superiority, statewide network,
diversity — would make Genoa the only paid tool that does this
correctly.  Material lift, but it lands on the NCE-window cycle which
is a hard deadline market.

### 3. DTV / ATSC 3.0 coverage and interference (§73.622)

**Class:** Strategic skip (for now).
The DTV market is V-Soft and H&D.  Building §73.622 *de minimis*,
NextGen-TV repack, and DTV F(50,90) curves is at least a quarter of
engineering work, and the audience overlap with FM/AM applicants is
small.  Skip until the FM/AM/LPFM core is at 100% adoption among the
target consulting shops, then revisit.

### 4. Rooftop / co-location §1.1310 OET-65 categorical exclusion

**Class:** Fix this week.
`engine/regulatory/oet65.js` produces a generic MPE percentage.  It
does not produce the site-survey-grade rooftop occupancy worksheet
that §1.1307(b) actually wants — controlled vs. uncontrolled, time
averaging, co-located emitters.  This is the difference between
"informational" and "filable", and consulting engineers will notice.

### 5. Microwave / STL / Part 101 point-to-point

**Class:** Future moat.
No path-budget, no rain-fade margin, no §101 coordination check.
Every consulting shop has a separate tool for this (often Pathloss).
A Part-101 module that read the FCC ULS coordination data and produced
a clean path-budget with Genoa's same evidence/replay contract would
absorb a tool the engineer is paying for separately.

### 6. AM tower-detuning / re-radiation field study

**Class:** Future moat.
Today the FAA OE sidecar flags proximate ASR towers as a warning, but
no field study is produced.  Re-radiation analysis is a recurring
billable for AM consultants and a natural fit for the SOMNEC2D sidecar
that already underwrites Appendix H.

### 7. Comparative MX-application analysis for FM auctions

**Class:** Future moat.
Single-facility population overlap exists; multi-applicant comparative
hearings (the FCC auction / settlement workflow) do not.  This is the
"who should win the LPFM window" tool.  Pairs with #2.

### 8. FM IBOC / HD Radio digital-sideband interference (§73.404)

**Class:** Fix this week.
Genoa computes only analog F(50,50) contours.  An IBOC mask overlay
and a digital-sideband interference contribution toggle would close
the gap with Probe's HD Radio modules.  The math is well-defined; the
work is mostly schema and a new curve dataset.

### 9. Build PSRA/PSSA into a self-serve §73.99 authorization request

**Class:** Fix today.
The engine produces filing-grade per-pair allowed power
(`Appendix G-2 / G-3`).  Wrap that in an LMS-filing export so an
operator can request §73.99 authorization end-to-end without leaving
Genoa.  Mostly schema + an additional export under
`exports/lmsFiling/`.

### 10. Population overlap from ACS / decennial census for AM

**Class:** Fix this week.
`evidence/acsCensusClient.js` exists.  Wire it through AM groundwave
contour areas the same way it is wired through FM, then expose it as
a Visual Summary row.  Adds the population-served number a station
group actually quotes in board meetings.

### 11. Allotment / Table-of-Allotments rule-making support (§1.420)

**Class:** Strategic skip.
Small market.  Hand off to the petitioning consultant; provide a clean
exhibit they can attach.  Not worth the schema work to encode an
RM-number lifecycle.

### 12. DRM / AM IBOC mask and 10 kHz IBOC interference

**Class:** Strategic skip.
US AM IBOC adoption is flat and declining.  Engineering effort is
better spent on the FM / LPFM moat.  Document the omission in
`COMPETITIVE.md` and move on.

### 13. Replay-bundle export (engine SHA + curve dataset + inputs as one .zip)

**Class:** Fix today.
Genoa already publishes the SHAs on the cover and in the build
attestation.  Shipping a single replay bundle — inputs JSON + curve
dataset tarball + engine version pin + a one-line replay script —
makes the determinism story tangible.  This is a half-day of work and
turns a contract into a demoable feature.

### 14. PE seal multi-signer / counter-sign workflow

**Class:** Fix this week.
`PeCertifyDialog.jsx` and `peCertification.js` support a single PE
stamp.  Real consulting shops have a designing engineer and a
reviewing engineer.  Extend the schema (`exhibit.pe_certification[]`)
and the cover/Appendix D renderer.

### 15. n8n workflow templates for routine studies

**Class:** Fix today.
The API is already automation-friendly.  Ship a handful of n8n
templates — *nightly move-in monitor*, *channel-search batch*,
*PE-stamped exhibit pipeline* — as a `templates/` directory with a
README.  Low engineering cost, high "this is a real product"
signal for the broadcast-group buyer.

---

## Summary by class

| Class | Items |
|---|---|
| Fix today | #9, #13, #15 |
| Fix this week | #1, #4, #8, #10, #14 |
| Future moat | #2, #5, #6, #7 |
| Strategic skip | #3, #11, #12 |

## What this list is not

This is **not** a list of bugs.  Open bugs go in the issue tracker.
This is the gap analysis between Genoa and the tools an experienced
broadcast engineer compares it to in a sales call.  Every item here is
either honest absence ("we don't do this yet") or honest scoping ("we
don't plan to do this").  No item here is hand-waved.
