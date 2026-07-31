#!/usr/bin/env bash
#
# Uptinger installer
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/<org>/<repo>/main/install.sh | bash
# or, from an already-cloned copy:
#   ./install.sh
#
set -euo pipefail

REPO_URL="${UPTINGER_REPO_URL:-https://github.com/fenilto-emitlogic/uptinger.git}"
INSTALL_DIR="${UPTINGER_INSTALL_DIR:-$PWD/uptinger}"
APP_PORT="${PORT:-4173}"

info()  { printf '\033[1;34m[uptinger]\033[0m %s\n' "$1"; }
warn()  { printf '\033[1;33m[uptinger]\033[0m %s\n' "$1"; }
error() { printf '\033[1;31m[uptinger]\033[0m %s\n' "$1" >&2; }

# --- 1. prerequisites -------------------------------------------------------

command -v docker >/dev/null 2>&1 || {
  error "Docker is required but was not found. Install it from https://docs.docker.com/get-docker/ and re-run this script."
  exit 1
}

if docker compose version >/dev/null 2>&1; then
  COMPOSE="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE="docker-compose"
else
  error "Docker Compose is required but was not found. Install the Compose plugin and re-run this script."
  exit 1
fi

# --- 2. get the source -------------------------------------------------------

if [ -f "./docker-compose.yml" ] && [ -f "./Dockerfile" ]; then
  info "Running from an existing checkout, using current directory."
  INSTALL_DIR="$PWD"
else
  command -v git >/dev/null 2>&1 || {
    error "git is required to fetch the source. Install it and re-run this script."
    exit 1
  }
  if [ -d "$INSTALL_DIR" ]; then
    info "Directory $INSTALL_DIR already exists, pulling latest changes."
    git -C "$INSTALL_DIR" pull --ff-only
  else
    info "Cloning uptinger into $INSTALL_DIR"
    git clone --depth 1 "$REPO_URL" "$INSTALL_DIR"
  fi
  cd "$INSTALL_DIR"
fi

# --- 3. configure .env -------------------------------------------------------

if [ -f ".env" ]; then
  info ".env already exists, leaving it untouched."
else
  info "Creating .env from .env.example"
  cp .env.example .env

  gen_secret() {
    if command -v openssl >/dev/null 2>&1; then
      openssl rand -hex 32
    else
      head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n'
    fi
  }

  ENCRYPTION_KEY="$(gen_secret)"
  JWT_ACCESS_SECRET="$(gen_secret)"

  # Portable in-place sed (macOS/BSD vs GNU)
  sedi() {
    if sed --version >/dev/null 2>&1; then
      sed -i "$@"
    else
      sed -i '' "$@"
    fi
  }

  sedi "s#^PORT=.*#PORT=${APP_PORT}#" .env
  sedi "s#^APP_URL=.*#APP_URL=http://localhost:${APP_PORT}#" .env
  sedi "s#^ENCRYPTION_KEY=.*#ENCRYPTION_KEY=${ENCRYPTION_KEY}#" .env
  sedi "s#^JWT_ACCESS_SECRET=.*#JWT_ACCESS_SECRET=${JWT_ACCESS_SECRET}#" .env

  info "Generated ENCRYPTION_KEY and JWT_ACCESS_SECRET automatically."
  warn "Review .env and adjust APP_URL / other values for your environment if needed."
fi

# --- 4. build & start --------------------------------------------------------

info "Building and starting the uptinger container..."
PORT="$APP_PORT" $COMPOSE up -d --build

info "Uptinger is starting up. It will be available at: http://localhost:${APP_PORT}"
info "Check logs with:   $COMPOSE logs -f"
info "Stop it with:      $COMPOSE down"
