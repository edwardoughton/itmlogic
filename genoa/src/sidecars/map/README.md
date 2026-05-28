# Genoa map sidecar

Headless-Chromium contour-map renderer.  Takes a Genoa exhibit JSON and
returns a PNG suitable for embedding in the engineering-statement PDF
or downloading as a stand-alone H&D-style contour map.

## Endpoints

| Method | Path     | Body                       | Returns                |
|--------|----------|----------------------------|------------------------|
| POST   | /render  | `{ exhibit, options? }`    | `image/png` body       |
| GET    | /health  | —                          | `{ ok, browser_pid, render_count, uptime_s }` |

`exhibit` must be a Genoa exhibit object — at minimum
`station_inputs.{lat, lon}` and a non-empty `polygons` array.

`options.width_px` / `options.height_px` override the image dimensions
for this request (defaults from env: 1500 × 1000).

## Configuration

| Env                          | Default            | Notes                                |
|------------------------------|--------------------|--------------------------------------|
| `SIDECAR_PORT`               | `8086`             | HTTP listen port                     |
| `PUPPETEER_EXECUTABLE_PATH`  | `/usr/bin/chromium`| System Chromium binary               |
| `RENDER_WIDTH_PX`            | `1500`             | Default render width (pixels)        |
| `RENDER_HEIGHT_PX`           | `1000`             | Default render height                |
| `RENDER_TIMEOUT_MS`          | `20000`            | Max time per render before erroring  |

## Operating model

The Chromium browser is kept warm across requests (start cost ~1 s,
per-render cost ~400 ms with tiles cached).  A fresh tab is opened per
request and closed when the screenshot lands.  Concurrent requests
share the browser; each gets its own tab.

The HTML template (`render.html`) is a self-contained Leaflet page that
reads the exhibit from `window.__EXHIBIT__` injected via
`page.evaluateOnNewDocument()`.  Tile load is awaited via the
`genoa-map-ready` window event the template fires after Leaflet's
`tileload` settles (with a 6 s hard fallback so a network-blocked
deploy still returns a printable map of the contour vectors alone).

## Local development

```sh
docker build -t genoa-map-sidecar .
docker run --rm -p 8086:8086 genoa-map-sidecar

curl -s -X POST http://localhost:8086/render \
  -H 'content-type: application/json' \
  -d '{"exhibit":{"station_inputs":{"call":"WBOB","lat":37.09,"lon":-95.71,"frequency":98.7,"erp_kw":6.0,"haat_m_input":100,"service":"FM"},"polygons":[]}}' \
  > out.png
```
