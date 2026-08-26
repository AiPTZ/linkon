#!/bin/bash
# Link ON - inicia backend, workers e frontend localmente.
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"

# Redis precisa estar rodando (filas BullMQ)
if ! redis-cli ping >/dev/null 2>&1; then
  echo "[Link ON] Redis nao esta rodando. Inicie com: redis-server --daemonize yes"
  exit 1
fi

echo "[Link ON] Subindo API (porta 3001)..."
(cd "$ROOT/backend" && npm run dev) &
BACKEND_PID=$!

echo "[Link ON] Subindo worker de convites..."
(cd "$ROOT/backend" && npm run dev:invite-worker) &
INVITE_PID=$!

echo "[Link ON] Subindo worker de chatbot..."
(cd "$ROOT/backend" && npm run dev:chatbot-worker) &
CHATBOT_PID=$!

echo "[Link ON] Subindo worker de busca..."
(cd "$ROOT/backend" && npm run dev:search-worker) &
SEARCH_PID=$!

echo "[Link ON] Subindo worker de varredura de rede..."
(cd "$ROOT/backend" && npm run dev:sweep-worker) &
SWEEP_PID=$!

cleanup() {
  echo
  echo "[Link ON] Encerrando processos..."
  kill "$BACKEND_PID" "$INVITE_PID" "$CHATBOT_PID" "$SEARCH_PID" "$SWEEP_PID" "$FRONTEND_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "[Link ON] Subindo frontend (http://localhost:5173)..."
(cd "$ROOT/frontend" && npm run dev) &
FRONTEND_PID=$!

wait "$FRONTEND_PID"
