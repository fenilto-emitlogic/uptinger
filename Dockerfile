# --- deps & build stage ---
FROM node:20-bookworm-slim AS builder

WORKDIR /app

# python3/make/g++ are needed to build better-sqlite3's native addon
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
# Note: `npm run build` also runs the Tailwind CLI, which needs src/views/input.css
# (not present in this repo). public/css/style.css is already committed pre-built,
# so we only run the TypeScript compile here.
RUN npx tsc

# --- runtime stage ---
FROM node:20-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production

# iputils-ping provides the system `ping` binary used by the `ping` npm package
RUN apt-get update && apt-get install -y --no-install-recommends \
    iputils-ping \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# node_modules already has the compiled better-sqlite3 addon from the builder,
# so we don't need build tools in the final image
COPY --from=builder /app/node_modules/better-sqlite3 ./node_modules/better-sqlite3
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/public ./public
COPY --from=builder /app/src/views ./src/views

RUN mkdir -p data

EXPOSE 4173

CMD ["node", "dist/server.js"]
