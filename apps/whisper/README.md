# crm-whisper

Serviço de transcrição self-hosted para audiências. Empacota [WhisperX](https://github.com/m-bain/whisperX) (Whisper large-v3 + alinhamento word-level + diarização pyannote) em FastAPI.

## Uso no stack

Roda como container na rede Docker. Worker do CRM chama via HTTP:

```
worker ─POST /transcribe──► crm-whisper ─GET s3/MinIO──► faster-whisper + pyannote
         ◄─{job_id}───
         ─GET /jobs/{id} (polling)──►
         ◄─{status, progress, result}─
```

A interface está em [packages/shared/src/transcription/](../../packages/shared/src/transcription/) — implementação `WhisperLocalProvider`. Pra trocar por Groq, seta `TRANSCRIPTION_PROVIDER=groq` e implementa o stub em [groq.provider.ts](../../packages/shared/src/transcription/groq.provider.ts).

## Pré-requisitos

1. **Conta HuggingFace** (gratuita): https://huggingface.co/join
2. **Aceitar termos de uso** dos modelos pyannote (cada um 1 clique em "Agree"):
   - https://huggingface.co/pyannote/speaker-diarization-3.1
   - https://huggingface.co/pyannote/segmentation-3.0
3. **Token de leitura**: https://huggingface.co/settings/tokens → New token → role: **read**
4. Colar em `HF_TOKEN=hf_...` no `.env` da stack.

Sem o token, o container sobe mas diarização falha. Transcrição sem diarização continua funcionando (desabilita via `DIARIZE=false`).

## Primeiro boot

No primeiro start o container baixa ~5GB de modelos pra `/models` (volume persistente `whisper_models`). Pode levar 10–20min. Logs:

```bash
docker logs -f crm-whisper
# "Carregando Whisper model=large-v3 device=cpu compute_type=int8"
# "Carregando modelo de alinhamento word-level lang=pt"
# "Carregando pipeline de diarização pyannote"
```

## Variáveis (override via .env)

| Var | Default | Descrição |
|---|---|---|
| `WHISPER_MODEL` | `large-v3` | tiny/base/small/medium/large-v3 |
| `DEVICE` | `cpu` | `cpu` ou `cuda` (requer nvidia-docker) |
| `COMPUTE_TYPE` | `int8` | `int8` (CPU rápido), `float16` (GPU), `float32` |
| `LANGUAGE` | `pt` | código ISO-639-1 |
| `DIARIZE` | `true` | separa falantes (pyannote) |
| `HF_TOKEN` | — | obrigatório se DIARIZE=true |

## Teste rápido (curl)

```bash
# Health
curl http://crm-whisper:8000/health

# Submit (do worker, usando s3_key interno)
curl -X POST http://crm-whisper:8000/transcribe \
  -H 'content-type: application/json' \
  -d '{"s3_key":"transcricoes/case-id/transcr-id/audio.wav","diarize":true}'
# → {"job_id":"..."}

curl http://crm-whisper:8000/jobs/{job_id}
# → {"status":"transcribing", "progress":45, ...}
# → {"status":"done", "result":{"text":"...","segments":[...]}}
```

## Estimativa de tempo (CPU 8 cores)

| Modelo | Tempo p/ 1h de áudio | RAM |
|---|---|---|
| `base`       | ~20 min | 2GB |
| `medium`     | ~1h30   | 4GB |
| `large-v3` (int8) | ~3h–6h | 6–8GB |
| `large-v3` (GPU) | ~5 min | 4GB VRAM |

Diarização adiciona ~20% de tempo.

## Troubleshooting

**"401 Unauthorized" ao carregar pyannote** → HF_TOKEN inválido ou termos não aceitos.

**"job não encontrado"** (404 no polling) → container reiniciou. O worker reenfileira via BullMQ `attempts`.

**Out of memory** → troca pra `medium` ou `small`. `large-v3` em int8 pede ~8GB.

**Muito lento** → considere Groq (ver [groq.provider.ts](../../packages/shared/src/transcription/groq.provider.ts)). 1h de áudio em ~30s a ~R$0,10.
