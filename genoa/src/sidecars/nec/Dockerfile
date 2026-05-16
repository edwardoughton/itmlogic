# Genoa NEC sidecar — NEC2++ / PyNEC antenna modeling.
#
# LICENSE
#   NEC2++ is GPL v2.  This image distributes the GPL'd binaries +
#   the GPL-isolated bridge.  Genoa's main API image does NOT contain
#   any of these — the boundary is enforced by running this sidecar
#   as a separate container that the API talks to over HTTP only.
#
# WHY THIS LAYOUT
#   * Multi-stage: a `necpp-build` stage compiles NEC2++ + PyNEC from
#     source (the PyPI sdist is broken; the apt `nec` package is no
#     longer in the default repos).  A slim `runtime` stage copies
#     only the resulting binaries + .so files + the Express server.
#   * Debian Bookworm: ships Node 18 (the `node:` URI prefix that
#     server.js uses requires Node 14.13+, so Ubuntu 22.04's apt
#     Node 12 is not viable).
#   * Single CMD; one COPY of each file; one express install; one
#     final image.

# ───────────────── necpp-build stage ─────────────────
FROM debian:bookworm-slim AS necpp-build
ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates git build-essential autoconf automake libtool \
        swig pkg-config python3 python3-pip python3-numpy python3-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build

# Build NEC2++ + PyNEC from source.  --recurse-submodules pulls
# necpp_src; ./configure --without-lapack avoids the LAPACK dep
# (only used for optimization paths Genoa doesn't exercise).
RUN git clone --depth=1 --recurse-submodules https://github.com/tmolteno/python-necpp.git python-necpp

WORKDIR /build/python-necpp/necpp_src
RUN make -f Makefile.git \
 && ./configure --without-lapack \
 && make -j"$(nproc)" \
 && make install \
 && ldconfig

WORKDIR /build/python-necpp/PyNEC
RUN ln -s ../necpp_src . \
 && swig -Wall -c++ -python PyNEC.i \
 && pip3 install --no-build-isolation --break-system-packages . \
 && python3 -c "import PyNEC; print('PyNEC OK at', PyNEC.__file__)"

# ───────────────── runtime stage ─────────────────
FROM debian:bookworm-slim AS runtime
ENV DEBIAN_FRONTEND=noninteractive

# Runtime deps only — no compilers, no git, no swig.
RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates python3 python3-numpy nodejs npm wget \
    && rm -rf /var/lib/apt/lists/*

# Copy only the build artifacts; no source, no toolchain.
COPY --from=necpp-build /usr/local/bin/nec2++           /usr/local/bin/nec2++
COPY --from=necpp-build /usr/local/lib/libnecpp.so      /usr/local/lib/libnecpp.so
COPY --from=necpp-build /usr/local/lib/libnecpp.la      /usr/local/lib/libnecpp.la
COPY --from=necpp-build /usr/local/lib/libnecpp.a       /usr/local/lib/libnecpp.a
COPY --from=necpp-build /usr/local/lib/python3.11/dist-packages/PyNEC.py \
                        /usr/local/lib/python3.11/dist-packages/PyNEC.py
COPY --from=necpp-build /usr/local/lib/python3.11/dist-packages/_PyNEC.cpython-311-x86_64-linux-gnu.so \
                        /usr/local/lib/python3.11/dist-packages/_PyNEC.cpython-311-x86_64-linux-gnu.so
RUN ldconfig

WORKDIR /app

# Sidecar source — single COPY of each file.
COPY server.js     /app/server.js
COPY nec_bridge.py /app/nec_bridge.py
RUN chmod +x /app/nec_bridge.py

# server.js is ESM (`import` statements) and depends on Express.
# Both requirements must be satisfied or `node /app/server.js` exits
# at boot with SyntaxError or Cannot-find-module 'express'.
RUN echo '{ "name": "genoa-nec-sidecar", "version": "0.1.0", "type": "module", "private": true }' > /app/package.json \
 && npm install --omit=dev express \
 && node -e "import('express').then(()=>console.log('express OK'))"

ENV SIDECAR_PORT=8085 \
    BRIDGE_TIMEOUT_MS=60000 \
    PYNEC_PYTHON_BIN=python3

EXPOSE 8085

# Healthcheck verifies both the Node server and PyNEC import.
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD wget -qO - http://localhost:8085/health | grep -q '"pynec_available":true' \
   || exit 1

CMD ["node", "/app/server.js"]
