/**
 * Lazy loader pro OpenCV.js do CDN oficial. ~8MB no primeiro load, depois
 * fica cacheado pelo navegador. Usado pelo scanner do portal pra detectar
 * cantos do documento e fazer perspective transform (jscanify depende de
 * `window.cv` global pronto).
 *
 * Por que CDN e nao bundle: opencv.js eh wasm + JS gigante, ele fica fora
 * do bundle do Next pra nao infectar paginas que nao usam scanner. CDN
 * com cache HTTP eh o caminho padrao recomendado pelo proprio OpenCV.
 *
 * Versao 4.8.0 escolhida por ser estavel e ter funcoes de contour/warp
 * que jscanify usa. Versoes 4.9+ mudaram o nome de algumas funcoes.
 */

const OPENCV_URL = 'https://docs.opencv.org/4.8.0/opencv.js';

// Mantemos a promise no escopo do modulo — multiplas chamadas reusam o
// mesmo carregamento (pre-warm + chamada real consolidam em uma so request).
let cvPromise: Promise<typeof window & { cv: any }> | null = null;

declare global {
  interface Window {
    cv?: any;
    Module?: any;
  }
}

export function loadOpenCV(): Promise<any> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('OpenCV so pode carregar no browser'));
  }
  // Ja carregado (cv com funcoes wasm prontas)
  if (window.cv && window.cv.Mat) {
    return Promise.resolve(window.cv);
  }
  if (cvPromise) return cvPromise;

  cvPromise = new Promise<any>((resolve, reject) => {
    // Hook que opencv.js executa quando o wasm termina de inicializar.
    // Tem que ser definido ANTES do script carregar.
    const existingModule = window.Module || {};
    window.Module = {
      ...existingModule,
      onRuntimeInitialized: () => {
        if (existingModule.onRuntimeInitialized) {
          try { existingModule.onRuntimeInitialized(); } catch {}
        }
        if (window.cv && window.cv.Mat) {
          resolve(window.cv);
        } else {
          reject(new Error('OpenCV inicializado mas cv.Mat indisponivel'));
        }
      },
    };

    // Se ja existe a tag mas o wasm nao terminou de inicializar ainda,
    // o onRuntimeInitialized acima vai disparar quando ficar pronto.
    if (document.querySelector(`script[data-opencv-loader]`)) {
      return;
    }

    const script = document.createElement('script');
    script.src = OPENCV_URL;
    script.async = true;
    script.dataset.opencvLoader = '1';
    script.onerror = () => {
      cvPromise = null; // permite retry
      reject(new Error('Falha ao baixar OpenCV.js do CDN'));
    };
    document.head.appendChild(script);
  });

  return cvPromise;
}

/**
 * Pre-aquece o OpenCV: dispara o download sem bloquear. Usado quando a UI
 * sabe que o usuario PROVAVELMENTE vai usar scanner em segundos. Ignora
 * erros — se falhar agora, tentamos de novo no uso real.
 */
export function prewarmOpenCV(): void {
  loadOpenCV().catch(() => {});
}
