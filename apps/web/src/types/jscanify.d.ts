/**
 * Type stub minimo pra jscanify (lib JS sem tipos publicados).
 * Usado pelo scanner de documentos do portal do cliente —
 * apps/web/src/app/portal/enviar-documento/page.tsx
 */

declare module 'jscanify/client' {
  /**
   * Constructor: `new Scanner()`
   * Requer `window.cv` global ja inicializado (use loadOpenCV antes).
   */
  class Scanner {
    constructor();
    /**
     * Detecta os 4 cantos do documento e aplica perspective transform.
     * Devolve canvas com a versao "endireitada" no tamanho pedido, ou
     * null se nao encontrar contorno claro.
     */
    extractPaper(
      image: HTMLImageElement | HTMLCanvasElement,
      resultWidth: number,
      resultHeight: number,
      cornerPoints?: any,
    ): HTMLCanvasElement | null;
    /** Desenha borda colorida sobre o documento detectado. */
    highlightPaper(
      image: HTMLImageElement | HTMLCanvasElement,
      options?: { color?: string; thickness?: number },
    ): HTMLCanvasElement;
  }
  export default Scanner;
}
