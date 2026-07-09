FROM denoland/deno:latest

WORKDIR /app

COPY deno.json ./
COPY src/ src/
COPY public/ public/

RUN mkdir -p /tmp/paa-data && chmod 777 /tmp/paa-data

# Cache dependencies (skip WASM — it's loaded at runtime via initSync)
RUN deno cache --no-check src/index-openshift.js || true

ENV PAA_SERVER_PORT=3000
ENV PAA_DATA_DIR=/tmp/paa-data
EXPOSE 3000

USER 1001

CMD ["deno", "run", "--allow-read", "--allow-write", "--allow-net", "--allow-env", "src/index-openshift.js"]
