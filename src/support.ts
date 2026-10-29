// Which emojis this device can draw. Runs in the page (canvas); nothing here is saved to data.json,
// because that file syncs between devices whose fonts differ.

const SIZE = 24;

function context(): CanvasRenderingContext2D | null {
  const canvas = createEl('canvas');
  canvas.width = SIZE * 2;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (ctx) {
    ctx.font = `${SIZE - 6}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
    ctx.textBaseline = 'middle';
  }
  return ctx;
}

/** True if the glyph is drawn in colour: a missing glyph comes out in the (red) fill colour. */
function drawnInColour(ctx: CanvasRenderingContext2D, char: string): boolean {
  ctx.clearRect(0, 0, SIZE * 2, SIZE);
  ctx.fillStyle = '#ff0000';
  ctx.fillText(char, 1, SIZE / 2);
  const px = ctx.getImageData(0, 0, SIZE * 2, SIZE).data;
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] > 200 && (px[i + 1] > 40 || px[i + 2] > 40)) return true;
  }
  return false;
}

/** Characters from `chars` this device draws badly: tofu, or a sequence that falls apart into parts. */
export function findUnsupported(chars: string[]): string[] {
  const ctx = context();
  if (!ctx) return [];
  const out: string[] = [];
  const widths = new Map<string, number>();
  const width = (s: string) => {
    let w = widths.get(s);
    if (w === undefined) widths.set(s, (w = ctx.measureText(s).width));
    return w;
  };
  for (const char of chars) {
    const cps = [...char];
    // Flags are drawn as two letters on Windows; they still carry the meaning, so keep them.
    if (cps.length === 2 && cps.every((c) => c.codePointAt(0)! >= 0x1f1e6 && c.codePointAt(0)! <= 0x1f1ff)) continue;
    let ok = drawnInColour(ctx, char);
    if (ok && cps.length > 1 && (char.includes('‍') || /[\u{1f3fb}-\u{1f3ff}]/u.test(char))) {
      ok = width(char) <= width(cps[0]) * 1.4;
    }
    if (!ok) out.push(char);
  }
  return out;
}
