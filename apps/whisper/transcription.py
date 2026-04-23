"""Pipeline WhisperX: transcrição + alinhamento word-level + diarização.

Modelos são carregados sob demanda e mantidos em memória (o container fica
vivo, então carregar 1x vale o preço). Em CPU, `large-v3` com compute_type
int8 é o melhor equilíbrio precisão/tempo.
"""

from __future__ import annotations

import gc
import logging
import os
from dataclasses import dataclass
from typing import Any

import whisperx

from config import settings

log = logging.getLogger("whisper.pipeline")


@dataclass
class TranscribeResult:
    text: str
    language: str
    duration_sec: float
    segments: list[dict[str, Any]]  # [{start, end, text, speaker?}]
    words: list[dict[str, Any]]  # [{start, end, word, speaker?}]


class WhisperPipeline:
    def __init__(self) -> None:
        self._asr = None
        self._align_model = None
        self._align_meta = None
        self._align_lang: str | None = None
        self._diarize = None

    def _load_asr(self):
        if self._asr is None:
            log.info(
                "Carregando Whisper model=%s device=%s compute_type=%s",
                settings.whisper_model,
                settings.device,
                settings.compute_type,
            )
            self._asr = whisperx.load_model(
                settings.whisper_model,
                device=settings.device,
                compute_type=settings.compute_type,
                language=settings.language or None,
            )
        return self._asr

    def _load_align(self, language: str):
        if self._align_model is None or self._align_lang != language:
            log.info("Carregando modelo de alinhamento word-level lang=%s", language)
            self._align_model, self._align_meta = whisperx.load_align_model(
                language_code=language, device=settings.device
            )
            self._align_lang = language
        return self._align_model, self._align_meta

    def _load_diarize(self):
        if self._diarize is None:
            if not settings.hf_token:
                raise RuntimeError(
                    "HF_TOKEN não configurado. Diarização precisa de token HuggingFace "
                    "e aceite dos termos em pyannote/speaker-diarization-3.1 e segmentation-3.0."
                )
            log.info("Carregando pipeline de diarização pyannote")
            self._diarize = whisperx.DiarizationPipeline(
                use_auth_token=settings.hf_token, device=settings.device
            )
        return self._diarize

    def transcribe(
        self,
        audio_path: str,
        diarize: bool | None = None,
        min_speakers: int | None = None,
        max_speakers: int | None = None,
    ) -> TranscribeResult:
        if not os.path.exists(audio_path):
            raise FileNotFoundError(audio_path)

        do_diarize = settings.diarize if diarize is None else diarize

        audio = whisperx.load_audio(audio_path)
        duration_sec = len(audio) / 16000.0

        asr = self._load_asr()
        result = asr.transcribe(audio, batch_size=settings.batch_size)
        language = result.get("language", settings.language or "pt")

        align_model, align_meta = self._load_align(language)
        aligned = whisperx.align(
            result["segments"],
            align_model,
            align_meta,
            audio,
            settings.device,
            return_char_alignments=False,
        )

        segments = aligned.get("segments", [])
        words = aligned.get("word_segments", [])

        if do_diarize:
            diar = self._load_diarize()
            diar_segments = diar(
                audio,
                min_speakers=min_speakers or settings.min_speakers,
                max_speakers=max_speakers or settings.max_speakers,
            )
            assigned = whisperx.assign_word_speakers(diar_segments, aligned)
            segments = assigned.get("segments", segments)
            words = assigned.get("word_segments", words)

        # limpeza defensiva — CPU/GPU odeia fragmentação
        gc.collect()

        text = " ".join((s.get("text") or "").strip() for s in segments).strip()

        return TranscribeResult(
            text=text,
            language=language,
            duration_sec=duration_sec,
            segments=[_clean_segment(s) for s in segments],
            words=[_clean_word(w) for w in words],
        )


def _clean_segment(s: dict[str, Any]) -> dict[str, Any]:
    return {
        "start": _round(s.get("start")),
        "end": _round(s.get("end")),
        "text": (s.get("text") or "").strip(),
        "speaker": s.get("speaker"),
    }


def _clean_word(w: dict[str, Any]) -> dict[str, Any]:
    return {
        "start": _round(w.get("start")),
        "end": _round(w.get("end")),
        "word": w.get("word"),
        "speaker": w.get("speaker"),
        "score": _round(w.get("score"), 3),
    }


def _round(v, nd: int = 2):
    if v is None:
        return None
    try:
        return round(float(v), nd)
    except (TypeError, ValueError):
        return None


pipeline = WhisperPipeline()
