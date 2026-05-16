# Genoa FCCAM sidecar — wraps the FCC's public-domain Fccam.for
# (Wang 1985 / Berry-Wang skywave model) per 47 CFR §73.190(c).
# Runs alongside the existing fcc-fortran-engine on the operator's
# DigitalOcean droplet; gives Genoa an authoritative 50% skywave
# field-strength source for AM nighttime allocation (§73.182).
#
# DEPLOY (operator, on droplet):
#   1) Obtain Fccam.for from the FCC's AM engineering page
#      (https://www.fcc.gov/media/radio/am-skywave-program) and
#      drop it into THIS directory (alongside this Dockerfile).
#      The build will FAIL fast if Fccam.for is missing — we do
#      not ship a stub binary.
#   2) docker build -t genoa-fccam .
#   3) docker run -d --name genoa-fccam \
#        -p 8090:8090 \
#        -e FCCAM_API_TOKEN="$(openssl rand -hex 32)" \
#        --restart unless-stopped genoa-fccam
#
# The container is single-process and stateless.  All inputs are
# normalized + hashed (input_sha256) so identical inputs produce
# identical outputs — replay determinism contract.

FROM debian:bookworm-slim
ENV DEBIAN_FRONTEND=noninteractive

# gfortran for the FCCAM compile, python+fastapi for the HTTP wrapper.
RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates curl \
        gfortran make \
        python3 python3-pip python3-venv \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Refuse to build a stub: the operator must drop the real Fccam.for
# into this directory before `docker build`.  The COPY fails fast
# when it's missing, which is the behavior we want — silently
# building a broken binary would be worse than no binary.
COPY Fccam.for /app/src/Fccam.for
COPY Makefile  /app/src/Makefile
RUN cd /app/src && make fccam && cp fccam /app/fccam \
    && sha256sum /app/src/Fccam.for | awk '{print $1}' > /app/.fccam_for_sha256 \
    && sha256sum /app/fccam         | awk '{print $1}' > /app/.fccam_bin_sha256

# Python wrapper.
RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"
COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

COPY main.py /app/main.py

ENV PORT=8090
EXPOSE 8090

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -fsS http://127.0.0.1:${PORT}/healthz || exit 1

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8090"]
