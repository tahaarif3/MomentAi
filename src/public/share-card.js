let htmlToImageModule = null;

async function loadHtmlToImage() {
  if (!htmlToImageModule) {
    htmlToImageModule = await import('https://cdn.jsdelivr.net/npm/html-to-image@1.11.13/+esm');
  }
  return htmlToImageModule;
}

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
  const heights = [14, 22, 18, 34, 20, 28, 16, 30, 24, 12, 26, 18, 32, 20, 14, 28, 22, 16, 30, 24, 18, 26, 20, 14];
  return heights
    .map((h, i) => `<span class="share-eq-bar${i % 3 === 0 ? ' share-eq-bar--solid' : ''}" style="height:${h}px"></span>`)
    .join('');
}

export async function rasterizeShareCard(cardEl, { width, height, pixelRatio = 2 } = {}) {
  const { toPng } = await loadHtmlToImage();
  const options = { pixelRatio, cacheBust: true };
  if (width && height) {
    options.canvasWidth = width;
    options.canvasHeight = height;
  }
  return toPng(cardEl, options);
}

export async function downloadShareCardPng(cardEl, filename = 'momentai-share.png') {
  const dataUrl = await rasterizeShareCard(cardEl);
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
