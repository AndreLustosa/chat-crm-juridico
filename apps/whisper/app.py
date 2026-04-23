"""FastAPI wrapping do pipeline WhisperX.

Endpoints:
  POST /transcribe   { s3_key | url, diarize?, min_speakers?, max_speakers? }
                      -> 202 { job_id }
  GET  /jobs/{id}    -> { status, progress, result?, error? }
  GET  /health       -> { ok, model_loaded }

Job registry é em memória — se o container reinicia, jobs in-flight viram
"lost" e o worker do Node re-enfileira. Mantido simples de propósito.
"""

from __future__ import annotations

import asyncio
import logging
import os
import shutil
import tempfile
import threading
import time
import uuid
from dataclasses import asdict, dataclass, field
from typing import Any, Literal

import boto3
import httpx
from botocore.client import Config as BotoConfig
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from config import settings
from transcription import pipeline

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s :: %(message)s",
)
log = logging.getLogger("whisper.api")

app = FastAPI(title="crm-whisper", version="0.1.0")

JobStatus = Literal["queued", "downloading", "transcribing", "diarizing", "done", "error"]


@dataclass
class Job:
    id: str
    status: JobStatus = "queued"
    progress: int = 0
    error: str | None = None
    result: dict[str, Any] | None = None
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)


_jobs: dict[str, Job] = {}
_jobs_lock = threading.Lock()
# Serializa transcrições — WhisperX em CPU não escala concorrência,
# rodar 2 ao mesmo tempo só troca contexto e fica mais lento.
_gpu_lock = threading.Lock()


class TranscribeRequest(BaseModel):
    s3_key: str | None = Field(None, description="Chave no bucket configurado")
    url: str | None = Field(None, description="URL pública HTTP(S) do áudio")
    diarize: bool | None = None
    min_speakers: int | None = None
    max_speakers: int | None = None


def _set(job: Job, **kwargs):
    for k, v in kwargs.items():
        setattr(job, k, v)
    job.updated_at = time.time()


def _s3_client():
    return boto3.client(
        "s3",
        endpoint_url=settings.s3_endpoint or None,
        region_name=settings.s3_region,
        aws_access_key_id=settings.s3_access_key or None,
        aws_secret_access_key=settings.s3_secret_key or None,
        config=BotoConfig(signature_version="s3v4"),
    )


def _download(job: Job, req: TranscribeRequest, dst: str):
    _set(job, status="downloading", progress=5)
    if req.s3_key:
        log.info("[%s] download s3://%s/%s", job.id, settings.s3_bucket, req.s3_key)
        _s3_client().download_file(settings.s3_bucket, req.s3_key, dst)
        return
    if req.url:
        log.info("[%s] download %s", job.id, req.url)
        with httpx.stream("GET", req.url, timeout=None) as r:
            r.raise_for_status()
            with open(dst, "wb") as f:
                for chunk in r.iter_bytes(1024 * 1024):
                    f.write(chunk)
        return
    raise ValueError("s3_key ou url obrigatório")


def _run_job(job_id: str, req: TranscribeRequest):
    job = _jobs[job_id]
    os.makedirs(settings.tmp_dir, exist_ok=True)
    tmpdir = tempfile.mkdtemp(prefix=f"job-{job_id}-", dir=settings.tmp_dir)
    try:
        audio_path = os.path.join(tmpdir, "input")
        _download(job, req, audio_path)

        with _gpu_lock:
            _set(job, status="transcribing", progress=20)
            log.info("[%s] iniciando transcrição", job.id)
            result = pipeline.transcribe(
                audio_path,
                diarize=req.diarize,
                min_speakers=req.min_speakers,
                max_speakers=req.max_speakers,
            )

        _set(
            job,
            status="done",
            progress=100,
            result={
                "text": result.text,
                "language": result.language,
                "duration_sec": result.duration_sec,
                "segments": result.segments,
                "words": result.words,
            },
        )
        log.info(
            "[%s] concluído: %.1fs áudio, %d segmentos",
            job.id,
            result.duration_sec,
            len(result.segments),
        )
    except Exception as e:
        log.exception("[%s] falhou: %s", job_id, e)
        _set(job, status="error", error=str(e))
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


@app.post("/transcribe", status_code=202)
async def transcribe(req: TranscribeRequest):
    if not req.s3_key and not req.url:
        raise HTTPException(400, "s3_key ou url obrigatório")

    job = Job(id=str(uuid.uuid4()))
    with _jobs_lock:
        _jobs[job.id] = job

    # roda em thread — WhisperX é blocking (CPU-bound), não cabe em asyncio
    loop = asyncio.get_event_loop()
    loop.run_in_executor(None, _run_job, job.id, req)

    return {"job_id": job.id, "status": job.status}


@app.get("/jobs/{job_id}")
async def get_job(job_id: str):
    job = _jobs.get(job_id)
    if not job:
        raise HTTPException(404, "job não encontrado")
    return asdict(job)


@app.get("/health")
async def health():
    return {
        "ok": True,
        "model_loaded": pipeline._asr is not None,
        "device": settings.device,
        "whisper_model": settings.whisper_model,
        "diarize_enabled": bool(settings.hf_token) and settings.diarize,
    }
