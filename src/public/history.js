const DEMO_TICKER_ITEMS = [
  { title: 'Golden hour rooftop', by: 'Maya', tracks: 24 },
  { title: 'Rainy commute', by: 'Alex', tracks: 18 },
  { title: 'Late night drive', by: 'Jordan', tracks: 22 },
  { title: 'Coffee shop window', by: 'Sam', tracks: 15 },
  { title: 'Sunday reset', by: 'Riley', tracks: 20 }
];

let tickerIndex = 0;
let tickerTimer = null;

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
    containerEl.innerHTML = `
      <span class="ticker-demo-label">(demo)</span>
      <span class="ticker-play" aria-hidden="true">▸</span>
      <span class="ticker-title">${escapeHtml(item.title)}</span>
      <span class="ticker-meta mono">by ${escapeHtml(item.by)} · ${item.tracks} tracks</span>
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
