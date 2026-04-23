# Deploy na VPS (Portainer)

Passos pra subir a feature de transcrição de audiências pela primeira vez.

## 1. Rodar a migration do Postgres

```bash
# Copia o SQL pra dentro do container postgres
docker cp packages/shared/prisma/manual-sql/2026-04-23-case-transcription.sql \
  <postgres_container>:/tmp/

# Aplica
docker exec -i <postgres_container> psql -U crm_user -d lustosa \
  -f /tmp/2026-04-23-case-transcription.sql

# Sanity check
docker exec -it <postgres_container> psql -U crm_user -d lustosa -c '\d "CaseTranscription"'
```

## 2. Configurar variáveis no Portainer

Na stack, adicione no .env (ou nas env vars do serviço `crm-whisper`):

```env
HF_TOKEN=hf_xxx                    # OBRIGATÓRIO para diarização
WHISPER_MODEL=large-v3             # ou medium se a VPS for enxuta
WHISPER_DEVICE=cpu                 # cuda se tiver GPU
WHISPER_COMPUTE_TYPE=int8          # float16 se GPU
TRANSCRIPTION_PROVIDER=whisper-local
WHISPER_SERVICE_URL=http://crm-whisper:8000
```

## 3. Build das 3 imagens

Na máquina local (com Docker Buildx ou Buildkit):

```bash
# Whisper (nova)
docker build -t andreflustosa/chat-crm-juridico-whisper:latest ./apps/whisper
docker push andreflustosa/chat-crm-juridico-whisper:latest

# API e worker (atualizam com ffmpeg + módulo novo)
docker build -t andreflustosa/chat-crm-juridico-api:latest \
  --build-arg APP=api -f infra/Dockerfile.backend .
docker push andreflustosa/chat-crm-juridico-api:latest

docker build -t andreflustosa/chat-crm-juridico-worker:latest \
  --build-arg APP=worker -f infra/Dockerfile.backend .
docker push andreflustosa/chat-crm-juridico-worker:latest

# Web (nova aba)
docker build -t andreflustosa/chat-crm-juridico-web:latest \
  -f infra/Dockerfile.web .
docker push andreflustosa/chat-crm-juridico-web:latest
```

## 4. Update da stack no Portainer

1. Edit stack → substituir YAML pelo novo [docker-compose.portainer.yml](../../docker-compose.portainer.yml)
2. "Update the stack" marcando "Re-pull image"
3. Aguarda ~15min na primeira subida (whisper baixa modelos)

## 5. Validação

### Whisper subiu?
```bash
curl http://<vps>:<port>/health  # (rede interna — melhor via docker exec)
docker exec crm-api sh -c 'wget -qO- http://crm-whisper:8000/health'
# → {"ok":true,"model_loaded":false,"device":"cpu",...}
```

### Worker tem ffmpeg?
```bash
docker exec crm-worker ffmpeg -version
# → ffmpeg version X.X.X
```

### Smoke test via UI
1. Entra num processo (workspace do caseId)
2. Clica na aba **Transcrições** (ícone audio lines)
3. "Nova transcrição" → escolhe um ASF de ~5min pra primeiro teste
4. Acompanha progresso: UPLOADING → CONVERTING → TRANSCRIBING → DIARIZING → DONE
5. Clica "Abrir" → confere player + texto sincronizado + falantes

### Logs úteis
```bash
docker logs -f crm-worker | grep -E '\[Transcri|ffmpeg'
docker logs -f crm-whisper
docker logs -f crm-api | grep -i transcri
```

## Rollback rápido

Se algo quebrar:
1. Stack → Update → volta imagens anteriores (sem `chat-crm-juridico-whisper`)
2. Migration: `DROP TABLE "CaseTranscription"` (ou só deixa — ela é aditiva)

## Notas operacionais

- **Primeiro processamento** sempre é mais lento (carrega modelos em memória). Deixe pré-aquecer com um arquivo curto antes de processar uma audiência real.
- **CPU-only + large-v3**: 1h de audiência → 3–6h de processamento. Prefira processar audiências da noite pro dia. A UI mostra progresso, pode fechar a aba.
- **Diarização exige HF_TOKEN válido**. Se o token expirar, o job falha com erro 401 — fácil de diagnosticar nos logs do whisper.
- **Storage**: cada audiência consome `source.ASF + video.MP4 + audio.WAV` no MinIO. Tipicamente 1.5–2× o tamanho original. Implementar cleanup cron se virar problema.
