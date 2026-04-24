#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# deploy-vps.sh — atualização interativa da stack Lustosa Advogados (Swarm)
# ─────────────────────────────────────────────────────────────────────────────
#
# Uso:
#   bash scripts/deploy-vps.sh        # menu interativo
#   bash scripts/deploy-vps.sh 1      # roda direto a opção 1 (sem perguntar)
#
# Pré-requisitos (uma vez só):
#   git clone https://github.com/AndreLustosa/chat-crm-juridico.git /home/lustosa/code/chat-crm-juridico
#   cd /home/lustosa/code/chat-crm-juridico
#
# Pra próximas atualizações, basta:
#   cd /home/lustosa/code/chat-crm-juridico && bash scripts/deploy-vps.sh
# ─────────────────────────────────────────────────────────────────────────────

set -e
cd "$(dirname "$0")/.."

STACK=lustosaadvogados

# ─── URLs públicas (CRÍTICO pro build do web) ───────────────────────────────
# Next.js grava variáveis NEXT_PUBLIC_* no bundle JS na hora do BUILD.
# Se não passar aqui, cai no fallback 'http://localhost:3005' e o CSP do
# browser em produção bloqueia tudo — sistema aparenta estar offline.
# Ref: incidente 2026-04-24 (deploy-vps.sh v1 sem esses args).
: ${PUBLIC_DOMAIN:=andrelustosaadvogados.com.br}
NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL:-https://$PUBLIC_DOMAIN/api}
NEXT_PUBLIC_WS_URL=${NEXT_PUBLIC_WS_URL:-wss://$PUBLIC_DOMAIN}
NEXT_PUBLIC_APP_URL=${NEXT_PUBLIC_APP_URL:-https://$PUBLIC_DOMAIN}

# ─── Helpers ────────────────────────────────────────────────────────────────

build_image() {
  local app=$1
  echo ""
  echo "▶ Buildando $app..."
  case "$app" in
    web)
      docker build \
        -t andreflustosa/chat-crm-juridico-web:latest \
        --build-arg NEXT_PUBLIC_API_URL="$NEXT_PUBLIC_API_URL" \
        --build-arg NEXT_PUBLIC_WS_URL="$NEXT_PUBLIC_WS_URL" \
        --build-arg NEXT_PUBLIC_APP_URL="$NEXT_PUBLIC_APP_URL" \
        -f infra/Dockerfile.web .
      ;;
    api)
      docker build \
        -t andreflustosa/chat-crm-juridico-api:latest \
        --build-arg APP=api \
        -f infra/Dockerfile.backend .
      ;;
    worker)
      docker build \
        -t andreflustosa/chat-crm-juridico-worker:latest \
        --build-arg APP=worker \
        -f infra/Dockerfile.backend .
      ;;
    whisper)
      docker build \
        -t andreflustosa/chat-crm-juridico-whisper:latest \
        ./apps/whisper
      ;;
    *)
      echo "  ✗ App desconhecido: $app"; exit 1 ;;
  esac
}

deploy_service() {
  local app=$1
  echo "▶ Atualizando service ${STACK}_crm-$app..."
  docker service update \
    --image "andreflustosa/chat-crm-juridico-$app:latest" \
    --force \
    "${STACK}_crm-$app" >/dev/null
  echo "  ✓ $app deployado"
}

build_and_deploy() {
  local app=$1
  build_image "$app"
  deploy_service "$app"
}

# ─── Menu ───────────────────────────────────────────────────────────────────

if [ -z "$1" ]; then
  cat <<EOF

  ┌─────────────────────────────────────────────────┐
  │  Atualizar Lustosa Advogados (Docker Swarm)     │
  ├─────────────────────────────────────────────────┤
  │   1) Tudo (web + api + worker)     [padrão]     │
  │   2) Web (frontend)                             │
  │   3) API                                        │
  │   4) Worker                                     │
  │   5) Whisper (transcrição self-hosted)          │
  │   6) Absolutamente tudo (inclui Whisper)        │
  │   0) Cancelar                                   │
  └─────────────────────────────────────────────────┘

EOF
  read -p "  Escolha [1]: " ESCOLHA
  ESCOLHA=${ESCOLHA:-1}
else
  ESCOLHA=$1
fi

# ─── Git pull ───────────────────────────────────────────────────────────────

if [ "$ESCOLHA" != "0" ]; then
  echo ""
  echo "▶ git pull..."
  git pull --ff-only
fi

# ─── Execução ───────────────────────────────────────────────────────────────

case "$ESCOLHA" in
  0)
    echo "Cancelado."
    exit 0
    ;;
  1)
    build_and_deploy web
    build_and_deploy api
    build_and_deploy worker
    ;;
  2) build_and_deploy web ;;
  3) build_and_deploy api ;;
  4) build_and_deploy worker ;;
  5) build_and_deploy whisper ;;
  6)
    build_and_deploy web
    build_and_deploy api
    build_and_deploy worker
    build_and_deploy whisper
    ;;
  *)
    echo "  ✗ Opção inválida: $ESCOLHA"
    exit 1
    ;;
esac

# ─── Status final ───────────────────────────────────────────────────────────

echo ""
echo "✓ Atualização concluída"
echo ""
docker service ls \
  --filter "label=com.docker.stack.namespace=$STACK" \
  --format 'table {{.Name}}\t{{.Replicas}}\t{{.Image}}'
