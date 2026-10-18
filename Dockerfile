# --- Stage 1: The Backend Builder ---
FROM rust:1.95-slim-bookworm AS backend-builder

RUN apt-get update && apt-get install -y pkg-config libssl-dev git && rm -rf /var/lib/apt/lists/*

WORKDIR /usr/src/app

RUN git clone https://github.com/pstlab/OBSERVISTA.git .

RUN cargo build --release

# --- Stage 2: Frontend Builder ---
FROM node:20-slim AS frontend-builder

RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*

WORKDIR /usr/src/app

RUN git clone https://github.com/pstlab/OBSERVISTA.git .

WORKDIR /usr/src/app/gui

RUN npm install && npm run build

# --- Stage 3: The Final Image ---
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y ca-certificates libssl3 && rm -rf /var/lib/apt/lists/*

COPY --from=backend-builder /usr/src/app/target/release/observista /usr/local/bin/observista
COPY --from=frontend-builder /usr/src/app/gui/dist /usr/local/bin/gui

WORKDIR /usr/local/bin

EXPOSE 3000

CMD ["observista"]