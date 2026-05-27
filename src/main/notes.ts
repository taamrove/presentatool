import JSZip from 'jszip';
import * as fs from 'fs';
import { parseStringPromise } from 'xml2js';

/**
 * Extracts presenter notes and slide titles from a .pptx file by reading the
 * OPC package directly. Returns one entry per slide. Works even when the
 * native app cannot expose live notes (e.g. on Linux).
 */
export async function readPptxOutline(filePath: string): Promise<{ title?: string; notes?: string }[]> {
  const data = fs.readFileSync(filePath);
  const zip = await JSZip.loadAsync(data);
  const slides: string[] = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort(naturalCompare);
  const notes: Record<string, string> = {};
  for (const name of Object.keys(zip.files)) {
    const m = name.match(/^ppt\/notesSlides\/notesSlide(\d+)\.xml$/);
    if (!m) continue;
    const xml = await zip.files[name].async('string');
    notes[m[1]] = await extractText(xml);
  }
  const out: { title?: string; notes?: string }[] = [];
  for (const slidePath of slides) {
    const idx = slidePath.match(/slide(\d+)\.xml$/)![1];
    const xml = await zip.files[slidePath].async('string');
    const title = await extractTitle(xml);
    out.push({ title, notes: notes[idx] });
  }
  return out;
}

async function extractTitle(xml: string): Promise<string | undefined> {
  try {
    const obj = await parseStringPromise(xml, { explicitArray: false });
    const shapes = arr(obj?.['p:sld']?.['p:cSld']?.['p:spTree']?.['p:sp']);
    for (const sp of shapes) {
      const ph = sp?.['p:nvSpPr']?.['p:nvPr']?.['p:ph'];
      const type = ph?.$?.type;
      if (type === 'title' || type === 'ctrTitle') {
        return collectText(sp?.['p:txBody']);
      }
    }
    return shapes.length > 0 ? collectText(shapes[0]?.['p:txBody']) : undefined;
  } catch { return undefined; }
}

async function extractText(xml: string): Promise<string> {
  try {
    const obj = await parseStringPromise(xml, { explicitArray: false });
    const shapes = arr(obj?.['p:notes']?.['p:cSld']?.['p:spTree']?.['p:sp']);
    const lines: string[] = [];
    for (const sp of shapes) {
      const ph = sp?.['p:nvSpPr']?.['p:nvPr']?.['p:ph'];
      const type = ph?.$?.type;
      if (type === 'body') lines.push(collectText(sp?.['p:txBody']));
    }
    return lines.filter(Boolean).join('\n').trim();
  } catch { return ''; }
}

function collectText(txBody: unknown): string {
  if (!txBody || typeof txBody !== 'object') return '';
  const paragraphs = arr((txBody as any)['a:p']);
  const out: string[] = [];
  for (const p of paragraphs) {
    const runs = arr(p?.['a:r']);
    const text = runs.map((r: any) => (typeof r?.['a:t'] === 'string' ? r['a:t'] : r?.['a:t']?._ ?? '')).join('');
    if (text) out.push(text);
  }
  return out.join('\n').trim();
}

function arr<T>(v: T | T[] | undefined | null): T[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

function naturalCompare(a: string, b: string): number {
  const na = Number(a.match(/(\d+)\.xml$/)?.[1] ?? 0);
  const nb = Number(b.match(/(\d+)\.xml$/)?.[1] ?? 0);
  return na - nb;
}
