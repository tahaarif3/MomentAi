/**
 * Share card: on-screen DOM preview + Canvas 2D export.
 * Avoids html-to-image / foreignObject half-width crops on retina & mobile.
 */

const EQ_HEIGHTS = [14, 22, 18, 34, 20, 28, 16, 30, 24, 12, 26, 18, 32, 20, 14, 28, 22, 16, 30, 24, 18, 26, 20, 14];
const ACCENT = '#e9a94f';
const TEXT = '#efe9df';
const MUTED = '#a49883';
const BG_TOP = '#2c1e10';
const BG_BOTTOM = '#17110c';

export function buildShareCardDom({
  title,
  moodLine,
  imageUrl,
  palette = [],
  playlistMeta = '',
  showWatermark = true
}) {
  const card = document.createElement('div');
  card.className = 'share-card-export';
  card.id = 'shareCardExport';
  // Stash export payload so download never depends on measured DOM width
  card.dataset.exportPayload = JSON.stringify({
    title: title || 'Your moment',
    moodLine: moodLine || '',
    imageUrl: imageUrl || '',
    palette: palette.slice(0, 4).length ? palette.slice(0, 4) : ['#c47b3a', '#8a6f52', '#2e3a4d', '#e3c48d'],
    playlistMeta: playlistMeta || '',
    showWatermark: !!showWatermark
  });

  const dots = (palette.slice(0, 4).length ? palette.slice(0, 4) : ['#c47b3a', '#8a6f52', '#2e3a4d', '#e3c48d'])
    .map((c) => `<span class="share-palette-dot" style="background:${c}"></span>`)
    .join('');

  const dateLabel = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase();

  card.innerHTML = `
    <div class="share-card-inner">
      <div class="share-card-header mono">
        <span class="share-card-brand">MOMENTAI · ${dateLabel}</span>
        <span class="share-card-meta-dim">${escapeHtml(playlistMeta)}</span>
      </div>
      <div class="share-card-photo" style="${imageUrl ? `background-image:url('${escapeAttr(imageUrl)}')` : ''}"></div>
      <h2 class="share-card-title">${escapeHtml(title)}</h2>
      <p class="share-card-mood mono">${escapeHtml(moodLine)}</p>
      <div class="share-equalizer" aria-hidden="true">${buildEqualizerBars()}</div>
      <div class="share-card-footer mono">
        <span class="share-footer-brand">${showWatermark ? '<span class="share-dot"></span> momentai.app' : ''}</span>
        <span class="share-palette-dots">${dots}</span>
      </div>
    </div>
  `;

  return card;
}

function buildEqualizerBars() {
  return EQ_HEIGHTS
    .map((h, i) => `<span class="share-eq-bar${i % 3 === 0 ? ' share-eq-bar--solid' : ''}" style="height:${h}px"></span>`)
    .join('');
}

function loadImage(url) {
  return new Promise((resolve) => {
    if (!url) {
      resolve(null);
      return;
    }
    const img = new Image();
    // Same-origin /uploads works; remote S3 needs CORS — fail soft if tainted
    if (/^https?:\/\//i.test(url) && !url.startsWith(window.location.origin)) {
      img.crossOrigin = 'anonymous';
    }
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

function wrapText(ctx, text, maxWidth) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  if (!words.length) return [''];
  const lines = [];
  let line = words[0];
  for (let i = 1; i < words.length; i += 1) {
    const test = `${line} ${words[i]}`;
    if (ctx.measureText(test).width <= maxWidth) {
      line = test;
    } else {
      lines.push(line);
      line = words[i];
    }
  }
  lines.push(line);
  return lines;
}

function roundRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function drawCoverImage(ctx, img, x, y, w, h, radius) {
  ctx.save();
  roundRect(ctx, x, y, w, h, radius);
  ctx.clip();
  if (!img) {
    ctx.fillStyle = '#241c15';
    ctx.fillRect(x, y, w, h);
  } else {
    const scale = Math.max(w / img.width, h / img.height);
    const dw = img.width * scale;
    const dh = img.height * scale;
    const dx = x + (w - dw) / 2;
    const dy = y + (h - dh) / 2;
    ctx.drawImage(img, dx, dy, dw, dh);
  }
  ctx.restore();
}

/**
 * Render a full-resolution share card onto a canvas and return a PNG data URL.
 * @param {object} payload
 * @param {{ story?: boolean, width?: number, height?: number }} opts
 */
export async function renderShareCardPng(payload, opts = {}) {
  const story = !!opts.story;
  const width = opts.width || 1080;

  const {
    title = 'Your moment',
    moodLine = '',
    imageUrl = '',
    palette = ['#c47b3a', '#8a6f52', '#2e3a4d', '#e3c48d'],
    playlistMeta = '',
    showWatermark = true
  } = payload || {};

  const img = await loadImage(imageUrl);

  // Layout constants (compute content height first for tight download crops)
  const padX = story ? 64 : 72;
  const padTop = story ? 96 : 64;
  const padBottom = story ? 96 : 64;
  const contentW = width - padX * 2;
  const titleSize = story ? 64 : 56;
  const moodSize = story ? 24 : 22;
  const photoH = story ? Math.floor(width * 0.95) : Math.floor(width * 0.55);
  const eqH = story ? 72 : 56;
  const headerH = story ? 56 : 48;
  const titleLineH = titleSize * 1.12;
  const moodLineH = moodSize * 1.35;

  // Measure wrapped lines with a scratch context
  const scratch = document.createElement('canvas').getContext('2d');
  scratch.font = `700 ${titleSize}px "Space Grotesk", system-ui, sans-serif`;
  const titleLines = wrapText(scratch, title, contentW).slice(0, 4);
  scratch.font = `500 ${moodSize}px "Space Mono", ui-monospace, monospace`;
  const moodLines = wrapText(scratch, String(moodLine || '').toUpperCase(), contentW).slice(0, 3);

  const contentHeight =
    padTop +
    headerH +
    photoH + (story ? 40 : 36) +
    titleLines.length * titleLineH + (story ? 12 : 10) +
    moodLines.length * moodLineH + (story ? 36 : 28) +
    eqH + (story ? 40 : 32) +
    2 + (story ? 28 : 24) +
    (story ? 36 : 32) +
    padBottom;

  const height = story ? (opts.height || 1920) : Math.ceil(contentHeight);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');

  const grad = ctx.createLinearGradient(0, 0, 0, height);
  grad.addColorStop(0, BG_TOP);
  grad.addColorStop(1, BG_BOTTOM);

  if (story) {
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);
  } else {
    roundRect(ctx, 0, 0, width, height, 48);
    ctx.fillStyle = grad;
    ctx.fill();
  }

  // Vertically center story content when shorter than frame
  let y = padTop;
  if (story && contentHeight < height) {
    y = Math.floor((height - (contentHeight - padTop - padBottom)) / 2);
  }

  const dateLabel = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase();

  ctx.fillStyle = ACCENT;
  ctx.font = `600 ${story ? 28 : 26}px "Space Mono", ui-monospace, monospace`;
  ctx.textBaseline = 'top';
  ctx.fillText(`MOMENTAI · ${dateLabel}`, padX, y);
  ctx.fillStyle = MUTED;
  ctx.textAlign = 'right';
  ctx.fillText(String(playlistMeta || '').toUpperCase(), width - padX, y);
  ctx.textAlign = 'left';
  y += headerH;

  drawCoverImage(ctx, img, padX, y, contentW, photoH, story ? 36 : 28);
  y += photoH + (story ? 40 : 36);

  ctx.fillStyle = TEXT;
  ctx.font = `700 ${titleSize}px "Space Grotesk", system-ui, sans-serif`;
  titleLines.forEach((line) => {
    ctx.fillText(line, padX, y);
    y += titleLineH;
  });
  y += story ? 12 : 10;

  ctx.fillStyle = MUTED;
  ctx.font = `500 ${moodSize}px "Space Mono", ui-monospace, monospace`;
  moodLines.forEach((line) => {
    ctx.fillText(line, padX, y);
    y += moodLineH;
  });
  y += story ? 36 : 28;

  const gap = story ? 6 : 5;
  const barW = (contentW - gap * (EQ_HEIGHTS.length - 1)) / EQ_HEIGHTS.length;
  const maxBar = Math.max(...EQ_HEIGHTS);
  EQ_HEIGHTS.forEach((h, i) => {
    const bh = (h / maxBar) * eqH;
    const bx = padX + i * (barW + gap);
    const by = y + eqH - bh;
    ctx.fillStyle = i % 3 === 0 ? ACCENT : 'rgba(233,169,79,0.35)';
    roundRect(ctx, bx, by, barW, bh, 3);
    ctx.fill();
  });
  y += eqH + (story ? 40 : 32);

  ctx.strokeStyle = 'rgba(236,231,223,0.08)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(padX, y);
  ctx.lineTo(width - padX, y);
  ctx.stroke();
  y += story ? 28 : 24;

  if (showWatermark) {
    const dotR = story ? 9 : 8;
    ctx.fillStyle = ACCENT;
    ctx.beginPath();
    ctx.arc(padX + dotR, y + dotR + 2, dotR, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = `500 ${story ? 26 : 24}px "Space Mono", ui-monospace, monospace`;
    ctx.fillText('momentai.app', padX + dotR * 2 + 12, y);
  }

  const dots = palette.slice(0, 4);
  const dotSize = story ? 22 : 18;
  let dx = width - padX - dots.length * (dotSize + 10) + 10;
  dots.forEach((color) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(dx + dotSize / 2, y + dotSize / 2 + 2, dotSize / 2, 0, Math.PI * 2);
    ctx.fill();
    dx += dotSize + 10;
  });

  return canvas.toDataURL('image/png');
}

function payloadFromCard(cardEl) {
  if (!cardEl) return null;
  try {
    if (cardEl.dataset.exportPayload) {
      return JSON.parse(cardEl.dataset.exportPayload);
    }
  } catch (_) { /* fall through */ }

  return {
    title: cardEl.querySelector('.share-card-title')?.textContent || 'Your moment',
    moodLine: cardEl.querySelector('.share-card-mood')?.textContent || '',
    imageUrl: (cardEl.querySelector('.share-card-photo')?.style.backgroundImage || '')
      .replace(/^url\(["']?/, '')
      .replace(/["']?\)$/, ''),
    palette: [...cardEl.querySelectorAll('.share-palette-dot')].map((el) => el.style.backgroundColor || '#c47b3a'),
    playlistMeta: cardEl.querySelector('.share-card-meta-dim')?.textContent || '',
    showWatermark: !!cardEl.querySelector('.share-footer-brand')?.textContent?.trim()
  };
}

/**
 * @param {HTMLElement} cardEl
 * @param {{ width?: number, height?: number, story?: boolean }} opts
 */
export async function rasterizeShareCard(cardEl, opts = {}) {
  const payload = payloadFromCard(cardEl);
  return renderShareCardPng(payload, {
    story: !!opts.story || !!(opts.width && opts.height && opts.width === 1080 && opts.height === 1920),
    width: opts.width,
    height: opts.height
  });
}

export async function downloadShareCardPng(cardEl, filename = 'momentai-share.png') {
  const payload = payloadFromCard(cardEl);
  // Auto-height card (no fixed tall canvas) — avoids empty half + crop bugs
  const dataUrl = await renderShareCardPng(payload, { story: false, width: 1080 });
  const link = document.createElement('a');
  link.download = filename;
  link.href = dataUrl;
  link.click();
}

export async function copyPlaylistLink(url) {
  if (!url) throw new Error('Save your playlist first to get a share link.');
  await navigator.clipboard.writeText(url);
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(str) {
  return String(str).replace(/'/g, '%27').replace(/"/g, '&quot;');
}
