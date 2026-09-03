#!/usr/bin/env bash
set -uo pipefail

echo "[linkon] Aplicando schema do banco (prisma db push)..."
npx prisma db push --skip-generate --schema prisma/schema.prisma
DB_PUSH_RC=$?
if [ "$DB_PUSH_RC" -ne 0 ]; then
  echo "[linkon] Falha no prisma db push (rc=$DB_PUSH_RC)"
  exit 1
fi

echo "[linkon] Iniciando processos..."

PIDS=()

start_proc() {
  local name="$1"
  shift
  "$@" &
  local pid=$!
  PIDS+=("$name:$pid")
  echo "[linkon] $name iniciado (pid $pid)"
}

start_proc "api"            node dist/index.js
start_proc "invite-worker"  node dist/workers/invite.worker.js
start_proc "chatbot-worker" node dist/workers/chatbot.worker.js
start_proc "search-worker"  node dist/workers/search.worker.js
start_proc "sweep-worker"   node dist/workers/sweep.worker.js
start_proc "contacts-worker" node dist/workers/contacts.worker.js

shutdown() {
  echo "[linkon] Encerrando processos..."
  for entry in "${PIDS[@]}"; do
    local name="${entry%%:*}"
    local pid="${entry##*:}"
    kill "$pid" 2>/dev/null || true
    echo "[linkon] $name encerrado"
  done
}

trap shutdown TERM INT EXIT

# Aguarda o primeiro processo que terminar.
# Se algum processo cair, derruba o resto e sai para o orquestrador reiniciar.
while true; do
  for entry in "${PIDS[@]}"; do
    local pid="${entry##*:}"
    if ! kill -0 "$pid" 2>/dev/null; then
      echo "[linkon] Processo caiu: $entry"
      shutdown
      exit 1
    fi
  done
  sleep 2
done
