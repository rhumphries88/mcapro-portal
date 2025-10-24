declare module 'tesseract.js' {
  export function recognize(
    image: string | Blob | ArrayBuffer | Uint8Array,
    langs?: string,
    options?: Record<string, unknown>
  ): Promise<{ data: { words?: Array<{ text?: string; bbox: { x0: number; y0: number; x1: number; y1: number } }> } }>;
}
