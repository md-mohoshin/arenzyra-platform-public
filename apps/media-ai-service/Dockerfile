FROM python:3.12.13-slim-bookworm@sha256:d50fb7611f86d04a3b0471b46d7557818d88983fc3136726336b2a4c657aa30b

ARG ARENZYRA_RELEASE_ID=
ARG ARENZYRA_SOURCE_DIGEST=
ARG ARENZYRA_GIT_COMMIT=
ARG ARENZYRA_BUILD_AT=
ARG ARENZYRA_BUILD_SOURCE=publish
LABEL org.opencontainers.image.version=${ARENZYRA_RELEASE_ID}
LABEL org.opencontainers.image.revision=${ARENZYRA_GIT_COMMIT}
LABEL org.opencontainers.image.created=${ARENZYRA_BUILD_AT}
LABEL com.arenzyra.source-digest=${ARENZYRA_SOURCE_DIGEST}
LABEL com.arenzyra.release-source=${ARENZYRA_BUILD_SOURCE}

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV U2NET_HOME=/models
# rembg imports pymatting functions compiled by Numba. Production runs with a
# read-only root filesystem, so its JIT cache must live on the bounded /tmp
# tmpfs rather than site-packages.
ENV NUMBA_CACHE_DIR=/tmp/numba

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates libgomp1 libglib2.0-0 \
  && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./
RUN python -m pip install --no-cache-dir --upgrade pip==26.2 \
  && python -m pip install --no-cache-dir -r requirements.txt

COPY main.py ./

RUN groupadd --system --gid 10001 media-ai \
  && useradd --system --uid 10001 --gid media-ai --home-dir /nonexistent --shell /usr/sbin/nologin media-ai \
  && mkdir -p /models \
  && chown -R media-ai:media-ai /models /app

EXPOSE 5055

USER 10001:10001

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "5055"]
