from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Modelo Whisper: tiny / base / small / medium / large-v3
    whisper_model: str = "large-v3"
    # cpu | cuda
    device: str = "cpu"
    # float16 (GPU) | int8 (CPU rápido, pouca perda) | float32
    compute_type: str = "int8"
    # pt, en, etc. None = auto-detect
    language: str = "pt"
    # Token HuggingFace (obrigatório pra pyannote). Aceite os termos em:
    #   https://huggingface.co/pyannote/speaker-diarization-3.1
    #   https://huggingface.co/pyannote/segmentation-3.0
    hf_token: str = ""
    # Ativa diarização (separar falantes). Se False, retorna só texto/segmentos.
    diarize: bool = True
    # Limites de speakers (None deixa pyannote detectar)
    min_speakers: int | None = None
    max_speakers: int | None = None
    # Batch size do whisperx (quanto maior, mais RAM, mais rápido)
    batch_size: int = 8
    # Pasta onde baixamos arquivos S3 temporariamente
    tmp_dir: str = "/tmp/whisper-jobs"
    # Config S3/MinIO (pra baixar áudio quando o worker passa um s3://key)
    s3_endpoint: str = ""
    s3_region: str = "us-east-1"
    s3_access_key: str = ""
    s3_secret_key: str = ""
    s3_bucket: str = ""


settings = Settings()
