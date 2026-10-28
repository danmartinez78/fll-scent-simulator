import { MODEL_NOTE } from '../content/help';
import { PLAN_KEYS, type TeamExperiment } from './experiments';
import { PLAN_COLORS } from './teamReport';
import type { TeamExperimentState } from './teamState';

const W = 1600;
const H = 900;
const FONT = '"Segoe UI", system-ui, -apple-system, Roboto, Arial, sans-serif';

function loadImage(src: string | undefined): Promise<HTMLImageElement | null> {
  if (!src || !/^data:image\/(jpeg|png);base64,/.test(src)) return Promise.resolve(null);
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/** Draw text wrapped to a width; returns the y below the last line. */
function wrap(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, width: number, lineH: number, maxLines: number): number {
  const words = text.split(/\s+/).filter(Boolean);
  let line = '';
  let lines = 0;
  for (let i = 0; i < words.length; i++) {
    const test = line ? `${line} ${words[i]}` : words[i];
    if (ctx.measureText(test).width > width && line) {
      if (lines === maxLines - 1) {
        ctx.fillText(`${line}…`, x, y);
        return y + lineH;
      }
      ctx.fillText(line, x, y);
      y += lineH;
      lines++;
      line = words[i];
    } else line = test;
  }
  if (line) {
    ctx.fillText(line, x, y);
    y += lineH;
  }
  return y;
}

/** A 16:9 picture of one experiment's results, ready to drop into a slide. */
export async function experimentSlidePng(exp: TeamExperiment, st: TeamExperimentState, teamName: string): Promise<Blob | null> {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const imgs = await Promise.all(PLAN_KEYS.map((k) => loadImage(st.runs[k]?.snapshot)));

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#1f6f3c';
  ctx.fillRect(0, 0, W, 110);
  ctx.fillStyle = '#ffffff';
  ctx.textBaseline = 'top';
  ctx.font = `700 48px ${FONT}`;
  ctx.fillText(`${exp.icon} ${exp.title}`, 50, 18);
  ctx.font = `400 26px ${FONT}`;
  wrap(ctx, exp.question, 50, 72, W - 100, 30, 1);

  const colW = (W - 150) / 2;
  PLAN_KEYS.forEach((k, i) => {
    const x = 50 + i * (colW + 50);
    const plan = exp.plans[k];
    const run = st.runs[k];
    ctx.fillStyle = PLAN_COLORS[k];
    ctx.fillRect(x, 135, 46, 46);
    ctx.fillStyle = '#ffffff';
    ctx.font = `700 32px ${FONT}`;
    ctx.fillText(k, x + 13, 140);
    ctx.fillStyle = '#1e293b';
    ctx.font = `700 36px ${FONT}`;
    ctx.fillText(`${plan.icon} ${plan.name}`, x + 60, 138);

    // The map, scaled to fit its box.
    const boxY = 200;
    const boxH = 360;
    const img = imgs[i];
    if (img) {
      const s = Math.min(colW / img.width, boxH / img.height);
      const w = img.width * s;
      const h = img.height * s;
      ctx.drawImage(img, x + (colW - w) / 2, boxY, w, h);
      ctx.strokeStyle = '#cbd5e1';
      ctx.lineWidth = 2;
      ctx.strokeRect(x + (colW - w) / 2, boxY, w, h);
    }

    // The numbers.
    let y = boxY + boxH + 20;
    if (run) {
      for (const n of exp.numbers) {
        ctx.fillStyle = '#64748b';
        ctx.font = `600 26px ${FONT}`;
        ctx.fillText(n.label, x, y + 6);
        ctx.fillStyle = '#1e293b';
        ctx.font = `700 34px ${FONT}`;
        const v = n.text(run.metrics, run.settings);
        ctx.fillText(v, x + colW - ctx.measureText(v).width, y);
        y += 46;
      }
    }
  });

  // What the team found, then the footer.
  let y = 730;
  const found = st.found.trim();
  if (found) {
    ctx.fillStyle = '#f0fdf4';
    ctx.fillRect(40, y - 12, W - 80, 118);
    ctx.fillStyle = '#1f6f3c';
    ctx.font = `700 26px ${FONT}`;
    ctx.fillText('What we found', 60, y);
    ctx.fillStyle = '#1e293b';
    ctx.font = `400 28px ${FONT}`;
    y = wrap(ctx, found, 60, y + 36, W - 120, 34, 2);
  }
  ctx.fillStyle = '#94a3b8';
  ctx.font = `400 18px ${FONT}`;
  const team = teamName.trim();
  ctx.fillText(`${team ? `${team} · ` : ''}Scent Dispersal Simulator · ${MODEL_NOTE}`, 50, H - 32);

  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/png'));
}
