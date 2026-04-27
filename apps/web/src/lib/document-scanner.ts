/**
 * Detecção e correção de perspectiva pra scanner de documentos.
 *
 * Roda em cima de OpenCV.js direto (carregado via opencv-loader). Foi
 * portado da logica do jscanify pra evitar a dep nativa `canvas` que
 * jscanify arrasta no `npm install` (quebrava o build do Docker — alpine
 * sem Python/Cairo).
 *
 * Algoritmo:
 *   1. Canny edge detection
 *   2. GaussianBlur pra suavizar ruido
 *   3. Otsu threshold pra binarizar
 *   4. findContours, pega o de maior area
 *   5. Pra cada vertice do contour, classifica em quadrante (TL/TR/BL/BR)
 *      pegando o ponto MAIS DISTANTE do centro em cada quadrante
 *   6. warpPerspective pra "endireitar" usando os 4 cantos
 *
 * Funcao tambem suporta cantos manuais — cliente arrasta 4 handles na UI
 * e chamamos warpToRect direto, pulando a deteccao automatica.
 */

import { loadOpenCV } from './opencv-loader';

export type Point = { x: number; y: number };

export type Corners = {
  topLeft: Point;
  topRight: Point;
  bottomRight: Point;
  bottomLeft: Point;
};

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Detecta os 4 cantos do documento na imagem. Devolve null se nao
 * encontrar contorno claro (foto sem documento bem-enquadrado, fundo
 * bagunçado, iluminacao baixa).
 */
export async function detectCorners(
  image: HTMLImageElement | HTMLCanvasElement,
): Promise<Corners | null> {
  const cv = await loadOpenCV();

  let img: any = null;
  let imgGray: any = null;
  let imgBlur: any = null;
  let imgThresh: any = null;
  let contours: any = null;
  let hierarchy: any = null;

  try {
    img = cv.imread(image);
    imgGray = new cv.Mat();
    cv.Canny(img, imgGray, 50, 200);

    imgBlur = new cv.Mat();
    cv.GaussianBlur(imgGray, imgBlur, new cv.Size(3, 3), 0, 0, cv.BORDER_DEFAULT);

    imgThresh = new cv.Mat();
    cv.threshold(imgBlur, imgThresh, 0, 255, cv.THRESH_OTSU);

    contours = new cv.MatVector();
    hierarchy = new cv.Mat();
    cv.findContours(imgThresh, contours, hierarchy, cv.RETR_CCOMP, cv.CHAIN_APPROX_SIMPLE);

    let maxArea = 0;
    let maxContourIndex = -1;
    for (let i = 0; i < contours.size(); ++i) {
      const area = cv.contourArea(contours.get(i));
      if (area > maxArea) {
        maxArea = area;
        maxContourIndex = i;
      }
    }

    if (maxContourIndex < 0) return null;

    // Sanity check: contorno tem que ter area minima razoavel (>5% da
    // imagem) pra valer como "documento". Senao eh provavelmente lixo
    // do Canny e perspective transform vai sair distorcido.
    const minArea = img.rows * img.cols * 0.05;
    if (maxArea < minArea) return null;

    const contour = contours.get(maxContourIndex);
    const rect = cv.minAreaRect(contour);
    const center = { x: rect.center.x, y: rect.center.y };

    let topLeft: Point | null = null;
    let topLeftDist = 0;
    let topRight: Point | null = null;
    let topRightDist = 0;
    let bottomLeft: Point | null = null;
    let bottomLeftDist = 0;
    let bottomRight: Point | null = null;
    let bottomRightDist = 0;

    // contour.data32S eh um Int32Array com [x0, y0, x1, y1, ...]
    const data = contour.data32S;
    for (let i = 0; i < data.length; i += 2) {
      const p: Point = { x: data[i], y: data[i + 1] };
      const d = distance(p, center);
      if (p.x < center.x && p.y < center.y) {
        if (d > topLeftDist) { topLeft = p; topLeftDist = d; }
      } else if (p.x > center.x && p.y < center.y) {
        if (d > topRightDist) { topRight = p; topRightDist = d; }
      } else if (p.x < center.x && p.y > center.y) {
        if (d > bottomLeftDist) { bottomLeft = p; bottomLeftDist = d; }
      } else if (p.x > center.x && p.y > center.y) {
        if (d > bottomRightDist) { bottomRight = p; bottomRightDist = d; }
      }
    }

    // Se algum quadrante ficou vazio (contour mal distribuido), nao da
    // pra fazer warp confiavel
    if (!topLeft || !topRight || !bottomLeft || !bottomRight) return null;

    return { topLeft, topRight, bottomRight, bottomLeft };
  } catch (e) {
    if (typeof console !== 'undefined') {
      console.warn('[scanner] detectCorners falhou:', e);
    }
    return null;
  } finally {
    img?.delete?.();
    imgGray?.delete?.();
    imgBlur?.delete?.();
    imgThresh?.delete?.();
    contours?.delete?.();
    hierarchy?.delete?.();
  }
}

/**
 * Aplica perspective transform pra "endireitar" o documento, dado os 4
 * cantos. Output em canvas com as dimensoes pedidas.
 *
 * Usado tanto pelo fluxo automatico (corners vindo de detectCorners) como
 * pelo fluxo manual (corners arrastados pelo cliente na UI).
 */
export async function warpToRect(
  image: HTMLImageElement | HTMLCanvasElement,
  corners: Corners,
  outWidth: number,
  outHeight: number,
): Promise<HTMLCanvasElement> {
  const cv = await loadOpenCV();
  const canvas = document.createElement('canvas');
  canvas.width = outWidth;
  canvas.height = outHeight;

  let img: any = null;
  let warped: any = null;
  let srcTri: any = null;
  let dstTri: any = null;
  let M: any = null;

  try {
    img = cv.imread(image);
    warped = new cv.Mat();

    srcTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
      corners.topLeft.x, corners.topLeft.y,
      corners.topRight.x, corners.topRight.y,
      corners.bottomLeft.x, corners.bottomLeft.y,
      corners.bottomRight.x, corners.bottomRight.y,
    ]);

    dstTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
      0, 0,
      outWidth, 0,
      0, outHeight,
      outWidth, outHeight,
    ]);

    M = cv.getPerspectiveTransform(srcTri, dstTri);
    cv.warpPerspective(
      img,
      warped,
      M,
      new cv.Size(outWidth, outHeight),
      cv.INTER_LINEAR,
      cv.BORDER_CONSTANT,
      new cv.Scalar(),
    );

    cv.imshow(canvas, warped);
    return canvas;
  } finally {
    img?.delete?.();
    warped?.delete?.();
    srcTri?.delete?.();
    dstTri?.delete?.();
    M?.delete?.();
  }
}

/**
 * Helper combinado: carrega a imagem, detecta cantos, faz warp. Devolve
 * canvas + corners (pra UI poder mostrar overlay e permitir ajuste manual
 * depois).
 */
export async function autoExtractFromDataUrl(
  dataUrl: string,
  outWidth: number,
  outHeight: number,
): Promise<{ canvas: HTMLCanvasElement; corners: Corners } | null> {
  const img = await loadImageEl(dataUrl);
  const corners = await detectCorners(img);
  if (!corners) return null;
  const canvas = await warpToRect(img, corners, outWidth, outHeight);
  return { canvas, corners };
}

/**
 * Re-aplica warp com cantos customizados (vindos do editor manual da UI).
 */
export async function warpFromDataUrl(
  dataUrl: string,
  corners: Corners,
  outWidth: number,
  outHeight: number,
): Promise<HTMLCanvasElement> {
  const img = await loadImageEl(dataUrl);
  return warpToRect(img, corners, outWidth, outHeight);
}

export function loadImageEl(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Falha ao carregar imagem'));
    img.src = src;
  });
}
