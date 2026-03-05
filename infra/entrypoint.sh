#!/bin/sh
set -e

# ─── Aguarda o PostgreSQL estar pronto ───────────────────────────────────────
wait_for_db() {
  echo "[entrypoint] Aguardando PostgreSQL ficar disponível..."
  # Extrai host:port do DATABASE_URL  (postgresql://user:pass@HOST:PORT/db)
  DB_HOST=$(echo "$DATABASE_URL" | sed -E 's|.*@([^:/]+):?([0-9]*).*|\1|')
  DB_PORT=$(echo "$DATABASE_URL" | sed -E 's|.*@[^:]+:([0-9]+)/.*|\1|')
  DB_PORT="${DB_PORT:-5432}"

  RETRIES=30
  until nc -z "$DB_HOST" "$DB_PORT" 2>/dev/null; do
    RETRIES=$((RETRIES - 1))
    if [ "$RETRIES" -le 0 ]; then
      echo "[entrypoint] ERRO: PostgreSQL não respondeu em ${DB_HOST}:${DB_PORT} após 30 tentativas. Abortando."
      exit 1
    fi
    echo "[entrypoint] PostgreSQL não disponível em ${DB_HOST}:${DB_PORT} — aguardando 2s... (${RETRIES} tentativas restantes)"
    sleep 2
  done
  echo "[entrypoint] PostgreSQL disponível em ${DB_HOST}:${DB_PORT}."
}

# ─── Migração do schema ───────────────────────────────────────────────────────
if [ "$RUN_MIGRATIONS" = "true" ]; then
  wait_for_db

  echo "[entrypoint] Aplicando schema do banco (prisma db push)..."
  cd /app/packages/shared

  # Tenta até 3 vezes em caso de falha transitória
  DB_PUSH_OK=0
  for attempt in 1 2 3; do
    if npx prisma db push --skip-generate --accept-data-loss 2>&1; then
      DB_PUSH_OK=1
      break
    fi
    echo "[entrypoint] prisma db push falhou (tentativa ${attempt}/3). Aguardando 3s..."
    sleep 3
  done

  if [ "$DB_PUSH_OK" = "0" ]; then
    echo "[entrypoint] AVISO: prisma db push falhou após 3 tentativas. A API vai subir mas tabelas novas podem estar ausentes."
  else
    echo "[entrypoint] Schema aplicado com sucesso."
  fi

  cd /app/apps/${APP}
fi

exec node dist/main.js
