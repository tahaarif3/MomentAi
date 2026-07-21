/**
 * Server-rendered public playlist page (/p/:id) with Open Graph tags.
 * Primary shareable / viral surface for multi-target output (Odesli option B).
 */

import { publicPlaylistUrl } from '../utils/moments.js';

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function serviceIcons(track) {
  const parts = [];
  if (track.spotifyUrl) {
    parts.push(
      `<a class="svc" href="${escapeHtml(track.spotifyUrl)}" rel="noopener noreferrer" target="_blank">Spotify</a>`
    );
  }
  if (track.appleUrl) {
    parts.push(
      `<a class="svc" href="${escapeHtml(track.appleUrl)}" rel="noopener noreferrer" target="_blank">Apple Music</a>`
    );
  }
  if (track.odesliLink) {
    parts.push(
      `<a class="svc svc-primary" href="${escapeHtml(track.odesliLink)}" rel="noopener noreferrer" target="_blank">Open anywhere</a>`
    );
  }
  return parts.join(' · ') || '<span class="muted">Link pending</span>';
}

/**
 * @param {object} opts
 * @param {object} opts.row - generation row
 * @param {object[]} opts.tracks - public track link objects
 * @param {string} opts.appBase
 */
export function renderPublicPlaylistHtml({ row, tracks, appBase }) {
  const title = row.emotional_vibe || row.playlist_name || 'MomentAI playlist';
  const description =
    row.environmental_context ||
    `${tracks.length} tracks curated from a moment — open in your streaming app.`;
  const shareUrl = publicPlaylistUrl(row.id, appBase);
  const image =
    (row.image_thumb && String(row.image_thumb).startsWith('http')
      ? row.image_thumb
      : null) ||
    (row.image_path && String(row.image_path).startsWith('http') ? row.image_path : null) ||
    `${appBase}/og-default.png`;

  const trackRows = tracks
    .map((t, i) => {
      const artist = t.artists?.[0]?.name || '';
      return `<li class="track">
        <span class="n">${i + 1}</span>
        <div class="meta">
          <strong>${escapeHtml(t.name || 'Track')}</strong>
          <span class="artist">${escapeHtml(artist)}</span>
          <div class="links">${serviceIcons(t)}</div>
        </div>
      </li>`;
    })
    .join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(title)} · MomentAI</title>
  <meta name="description" content="${escapeHtml(description)}" />
  <meta property="og:type" content="music.playlist" />
  <meta property="og:site_name" content="MomentAI" />
  <meta property="og:title" content="${escapeHtml(title)}" />
  <meta property="og:description" content="${escapeHtml(description)}" />
  <meta property="og:url" content="${escapeHtml(shareUrl)}" />
  <meta property="og:image" content="${escapeHtml(image)}" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${escapeHtml(title)}" />
  <meta name="twitter:description" content="${escapeHtml(description)}" />
  <meta name="twitter:image" content="${escapeHtml(image)}" />
  <meta name="apple-itunes-app" content="app-id=PLACEHOLDER, app-argument=${escapeHtml(shareUrl)}" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;700&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet" />
  <style>
    :root {
      --bg: #17110c;
      --bg2: #2a1f16;
      --text: #ece5da;
      --muted: #9a8f80;
      --accent: #e9a94f;
      --line: rgba(233,169,79,0.22);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      font-family: "Space Grotesk", system-ui, sans-serif;
      color: var(--text);
      background:
        radial-gradient(ellipse 80% 50% at 50% -10%, rgba(233,169,79,0.18), transparent),
        linear-gradient(180deg, var(--bg), var(--bg2));
    }
    .wrap { max-width: 640px; margin: 0 auto; padding: 28px 20px 64px; }
    .brand {
      display: inline-flex; align-items: center; gap: 10px;
      color: var(--accent); text-decoration: none;
      font-family: "Space Mono", monospace; font-size: 0.85rem; letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    .brand-mark {
      width: 10px; height: 10px; border-radius: 50%;
      background: var(--accent); box-shadow: 0 0 16px rgba(233,169,79,0.55);
    }
    h1 { font-size: clamp(1.8rem, 5vw, 2.6rem); line-height: 1.15; margin: 18px 0 8px; }
    .sub { color: var(--muted); margin: 0 0 28px; }
    .cta {
      display: inline-block; margin-bottom: 28px;
      background: var(--accent); color: #17110c; font-weight: 700;
      text-decoration: none; padding: 12px 18px; border-radius: 999px;
    }
    .cta.ghost {
      background: transparent; color: var(--accent);
      border: 1px solid var(--line); margin-left: 8px;
    }
    ol { list-style: none; padding: 0; margin: 0; }
    .track {
      display: grid; grid-template-columns: 2rem 1fr; gap: 12px;
      padding: 14px 0; border-top: 1px solid var(--line);
    }
    .n { font-family: "Space Mono", monospace; color: var(--muted); padding-top: 2px; }
    .meta strong { display: block; font-size: 1.05rem; }
    .artist { color: var(--muted); font-size: 0.92rem; }
    .links { margin-top: 6px; font-size: 0.85rem; }
    .svc { color: var(--muted); text-decoration: none; }
    .svc:hover { color: var(--text); }
    .svc-primary { color: var(--accent); }
    .muted { color: var(--muted); }
    footer { margin-top: 40px; color: var(--muted); font-size: 0.85rem; }
    footer a { color: var(--accent); }
  </style>
</head>
<body>
  <div class="wrap">
    <a class="brand" href="${escapeHtml(appBase)}"><span class="brand-mark"></span> MomentAI</a>
    <h1>${escapeHtml(title)}</h1>
    <p class="sub">${escapeHtml(description)}</p>
    <div>
      <a class="cta" href="https://apps.apple.com/">Get the app</a>
      <a class="cta ghost" href="${escapeHtml(appBase)}">momentai.dev</a>
    </div>
    <ol>
      ${trackRows || '<li class="muted">No tracks yet.</li>'}
    </ol>
    <footer>
      Made with MomentAI ·
      <a href="${escapeHtml(appBase)}/privacy.html">Privacy</a> ·
      <a href="${escapeHtml(appBase)}/terms.html">Terms</a>
    </footer>
  </div>
</body>
</html>`;
}

export { toPublicTrackLinks } from './trackLinkService.js';
