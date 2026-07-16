const DEMO_TICKER_ITEMS = [
  { title: 'Golden hour rooftop', by: 'Maya', tracks: 24, hue: 32 },
  { title: 'Rainy commute', by: 'Alex', tracks: 18, hue: 210 },
  { title: 'Late night drive', by: 'Jordan', tracks: 22, hue: 280 },
  { title: 'Coffee shop window', by: 'Sam', tracks: 15, hue: 24 },
  { title: 'Sunday reset', by: 'Riley', tracks: 20, hue: 150 },
  { title: 'Neon alley walk', by: 'Chris', tracks: 21, hue: 320 },
  { title: 'Soft morning light', by: 'Taylor', tracks: 16, hue: 45 }
];

let tickerIndex = 0;
let tickerTimer = null;

/** Fake album-cover gradient from a hue seed (no external images). */
function coverStyle(hue) {
  const h2 = (hue + 40) % 360;
  return `background: linear-gradient(145deg, hsl(${hue} 55% 42%), hsl(${h2} 40% 18%));`;
}

function formatMomentDate(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toLowerCase();
}

function momentTitle(row) {
  if (row.playlist_name) return row.playlist_name;
  if (row.emotional_vibe) {
    const words = row.emotional_vibe.split(/\s+/).slice(0, 4).join(' ');
    return words.charAt(0).toUpperCase() + words.slice(1);
  }
  return 'Untitled moment';
}

export function startDemoTicker(containerEl) {
  if (!containerEl) return;
  stopDemoTicker();

  const render = () => {
    const item = DEMO_TICKER_ITEMS[tickerIndex % DEMO_TICKER_ITEMS.length];
    tickerIndex += 1;
    const secondsAgo = 3 + ((tickerIndex * 7) % 40);
    containerEl.innerHTML = `
      <div class="ticker-cover" style="${coverStyle(item.hue)}" aria-hidden="true"></div>
      <div class="ticker-copy">
        <span class="ticker-title">${escapeHtml(item.title)}</span>
        <span class="ticker-meta mono">just generated · ${secondsAgo}s ago · ${item.tracks} tracks · by ${escapeHtml(item.by)}</span>
      </div>
      <span class="ticker-demo-label">(demo)</span>
    `;
  };

  render();
  tickerTimer = setInterval(render, 4000);
}

export function stopDemoTicker() {
  if (tickerTimer) {
    clearInterval(tickerTimer);
    tickerTimer = null;
  }
}

export async function fetchHistory(apiFetch) {
  const res = await apiFetch('/api/playlist/history');
  if (!res.ok) {
    if (res.status === 401) return { remainingToday: null, history: [] };
    throw new Error('Failed to load your moments.');
  }
  return res.json();
}

export function renderMomentsGrid(gridEl, history, { onOpen, onSignInNudge, isLoggedIn }) {
  if (!gridEl) return;

  gridEl.innerHTML = '';

  if (!isLoggedIn) {
    gridEl.innerHTML = `
      <button type="button" class="moment-nudge-card" id="btnMomentsSignIn">
        <p class="mono eyebrow-amber">YOUR MOMENTS</p>
        <p class="moment-nudge-title">Sign in to save &amp; revisit playlists</p>
        <p class="moment-nudge-sub">Every capture becomes a moment you can reopen anytime.</p>
      </button>
    `;
    document.getElementById('btnMomentsSignIn')?.addEventListener('click', onSignInNudge);
    return;
  }

  if (!history?.length) {
    gridEl.innerHTML = `<p class="moments-empty mono">No saved moments yet — capture your first one above.</p>`;
    return;
  }

  history.forEach((row) => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'moment-card';
    card.dataset.generationId = row.id;
    const imgSrc = row.image_path?.startsWith('http') ? row.image_path : row.image_path;
    const trackLabel = row.track_count === 1 ? '1 track' : `${row.track_count || 0} tracks`;
    card.innerHTML = `
      <div class="moment-card-photo" style="background-image:url('${escapeAttr(imgSrc)}')"></div>
      <p class="moment-card-title">${escapeHtml(momentTitle(row))}</p>
      <p class="moment-card-meta mono">${formatMomentDate(row.created_at)} · ${trackLabel}</p>
    `;
    card.addEventListener('click', () => onOpen(row.id));
    gridEl.appendChild(card);
  });
}

export function updateMomentsCounter(el, remainingToday, tier) {
  if (!el) return;
  if (tier === 'premium') {
    el.innerHTML = 'Unlimited moments · <button type="button" class="link-amber" data-action="paywall">Plus active</button>';
    return;
  }
  const left = remainingToday ?? 3;
  el.innerHTML = `${left} of 3 free moments left today · <button type="button" class="link-amber" data-action="paywall">go unlimited ›</button>`;
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
