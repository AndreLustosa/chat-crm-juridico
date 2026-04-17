#!/bin/sh
set -e

# ─── Auto-migração do schema Prisma ──────────────────────────────────────────
# Comportamento:
#   - Container API: sempre aplica schema no startup (a menos que RUN_MIGRATIONS=false)
#   - Container worker: NUNCA aplica (evita race condition API vs worker)
#   - Qualquer valor de RUN_MIGRATIONS=false força skip (opt-out explícito)
#
# Historicamente o antigo comportamento era "só roda se RUN_MIGRATIONS=true".
# Inverteu-se porque esquecer essa env var causa bugs sutis: novo deploy com
# schema novo quebra queries silenciosamente até alguém rodar manual.

SHOULD_MIGRATE="false"

if [ "$APP" = "api" ] && [ "$RUN_MIGRATIONS" != "false" ]; then
  SHOULD_MIGRATE="true"
fi

# Compat: se RUN_MIGRATIONS=true for setado explicitamente em qualquer container,
# também respeita (não quebra stacks antigas que dependem do flag)
if [ "$RUN_MIGRATIONS" = "true" ]; then
  SHOULD_MIGRATE="true"
fi

if [ "$SHOULD_MIGRATE" = "true" ]; then
  echo "[entrypoint] APP=$APP — aplicando schema do banco (prisma db push)..."
  cd /app/packages/shared

  # Tenta até 15 vezes com intervalo de 3s
  # Aguarda o postgres ficar disponível sem precisar de nc/netcat
  ATTEMPT=0
  while [ $ATTEMPT -lt 15 ]; do
    if npx prisma db push --skip-generate --accept-data-loss 2>&1; then
      echo "[entrypoint] Schema aplicado com sucesso."
      break
    fi
    ATTEMPT=$((ATTEMPT + 1))
    echo "[entrypoint] prisma db push falhou (tentativa $ATTEMPT/15). Aguardando 3s..."
    sleep 3
  done

  cd /app/apps/${APP}
else
  echo "[entrypoint] APP=$APP RUN_MIGRATIONS=$RUN_MIGRATIONS — pulando auto-migração."
fi

exec node dist/main.js
