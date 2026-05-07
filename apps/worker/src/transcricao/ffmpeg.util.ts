import { spawn } from 'child_process';
import { Logger } from '@nestjs/common';

const log = new Logger('ffmpeg');

/**
 * Converte vídeo em qualquer formato (ASF/WMV/MKV/etc.) para MP4 web-friendly
 * (H.264 + AAC, moov no início). Otimizado pra streaming no `<video>` HTML.
 *
 * `-movflags +faststart` é crítico: sem isso o browser precisa baixar o arquivo
 * inteiro antes de começar a tocar.
 */
export async function convertToMp4(input: string, output: string): Promise<void> {
  await runFfmpeg([
    '-y',
    '-i', input,
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '23',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-movflags', '+faststart',
    output,
  ]);
}

/**
 * Extrai áudio mono 16kHz em formato WAV — formato ideal pro Whisper local.
 * Evita overhead do Whisper ter que resampling internamente.
 */
export async function extractAudioWav(input: string, output: string): Promise<void> {
  await runFfmpeg([
    '-y',
    '-i', input,
    '-vn',            // sem vídeo
    '-ac', '1',       // mono
    '-ar', '16000',   // 16kHz
    '-acodec', 'pcm_s16le',
    '-f', 'wav',
    output,
  ]);
}

/**
 * Extrai áudio mono 16kHz em MP3 com bitrate baixo — pro Groq que tem
 * limite de 25MB. Voz humana fica clara em 32kbps mono → ~14MB pra 1h.
 * Audiência de 2h ainda cabe.
 */
export async function extractAudioMp3(input: string, output: string, bitrateKbps = 32): Promise<void> {
  await runFfmpeg([
    '-y',
    '-i', input,
    '-vn',
    '-ac', '1',
    '-ar', '16000',
    '-codec:a', 'libmp3lame',
    '-b:a', `${bitrateKbps}k`,
    output,
  ]);
}

/**
 * Timeout duro do processo ffmpeg. Cobre arquivo malformado / corrupcao
 * que faz o decoder travar indefinidamente — sem isso o worker fica
 * pendurado segurando memoria ate o BullMQ MAX_WAIT_MS (12h em alguns
 * processors). 30min eh generoso pra audiencia de 4h.
 */
const FFMPEG_TIMEOUT_MS = 30 * 60 * 1000;

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', args);
    let lastStderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      log.warn(`ffmpeg timeout apos ${FFMPEG_TIMEOUT_MS / 1000 / 60}min — matando processo`);
      // SIGKILL (nao SIGTERM) porque ffmpeg as vezes ignora SIGTERM
      // quando esta no meio de decode de frame corrompido.
      try { proc.kill('SIGKILL'); } catch {}
    }, FFMPEG_TIMEOUT_MS);

    proc.stderr.on('data', (chunk) => {
      const line = chunk.toString();
      // ffmpeg cospe progresso em stderr — mantemos a última linha pra diagnóstico
      lastStderr = line.split('\n').filter(Boolean).pop() || lastStderr;
    });
    proc.on('error', (err) => {
      clearTimeout(timer);
      log.error(`ffmpeg falhou ao iniciar: ${err.message}`);
      reject(err);
    });
    proc.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) {
        return reject(new Error(`ffmpeg timeout apos ${FFMPEG_TIMEOUT_MS / 1000 / 60}min`));
      }
      if (code === 0) return resolve();
      reject(new Error(`ffmpeg exit ${code}: ${lastStderr}`));
    });
  });
}
