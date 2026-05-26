# syntax=docker/dockerfile:1.7

FROM rust:1.92-slim@sha256:bf3368a992915f128293ac76917ab6e561e4dda883273c8f5c9f6f8ea37a378e

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    git \
    pkg-config \
    libssl-dev \
    curl \
    && rm -rf /var/lib/apt/lists/*
COPY --chmod=755 scripts/cargo-mirror-fallback.sh /usr/local/bin/cargo-mirror-fallback.sh

RUN /usr/local/bin/cargo-mirror-fallback.sh rustup \
    rustup toolchain install 1.92.0 --profile minimal --component rustfmt --component clippy

RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/usr/local/cargo/git \
    /usr/local/bin/cargo-mirror-fallback.sh cargo sh -c '\
      cargo install --locked cargo-audit --version 0.22.1 && \
      cargo install --locked cargo-deny --version 0.18.5'

WORKDIR /workspace

CMD ["bash"]
