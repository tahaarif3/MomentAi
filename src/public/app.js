// Base API URL configuration
// If running in Capacitor (protocol is capacitor: or hostname is localhost with no port),
// point to the hosted backend. Otherwise, use relative paths.
const API_BASE = (
  window.location.protocol === 'capacitor:' ||
  (window.location.hostname === 'localhost' && !window.location.port)
)
  ? 'https://your-server-domain.com' // <-- REPLACE WITH YOUR HOSTED API DOMAIN
  : '';

// Helper wrapper for fetches to support cross-origin API credentials (cookies) in Capacitor
async function apiFetch(path, options = {}) {
  const url = `${API_BASE}${path}`;
  options.credentials = 'include';
  return fetch(url, options);
}

// Application state
let authState = {
  loggedIn: false,
  user: null
};

let currentGeneration = {
  id: null,
  imagePath: null,
  metadata: null,
  tracks: []
};

let activeTrack = null;
let stagedFile = null;
let currentAudio = null;
let currentAudioVolume = 0.5;

// DOM Elements
const userPanel = document.getElementById('userPanel');
const btnConnectSpotify = document.getElementById('btnConnectSpotify');
const uploadCard = document.getElementById('uploadCard');
const analysisCard = document.getElementById('analysisCard');
const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
const sourceImagePreview = document.getElementById('sourceImagePreview');
const analysisLoader = document.getElementById('analysisLoader');
const btnResetImage = document.getElementById('btnResetImage');
const dropZoneContent = document.getElementById('dropZoneContent');
const uploadPreview = document.getElementById('uploadPreview');
const btnGeneratePlaylist = document.getElementById('btnGeneratePlaylist');
const importCard = document.getElementById('importCard');
const importUrlInput = document.getElementById('importUrlInput');
const btnImportPlaylist = document.getElementById('btnImportPlaylist');

// Results elements
const colorTags = document.getElementById('colorTags');
const envContext = document.getElementById('envContext');
const emotionalVibe = document.getElementById('emotionalVibe');
const genreTags = document.getElementById('genreTags');
const valValence = document.getElementById('valValence');
const barValence = document.getElementById('barValence');
const valEnergy = document.getElementById('valEnergy');
const barEnergy = document.getElementById('barEnergy');
const valAcousticness = document.getElementById('valAcousticness');
const barAcousticness = document.getElementById('barAcousticness');

// Playlist elements
const tracklistContainer = document.getElementById('tracklistContainer');
const playlistStatusText = document.getElementById('playlistStatusText');
const btnSavePlaylist = document.getElementById('btnSavePlaylist');
const spotifyPlayerContainer = document.getElementById('spotifyPlayerContainer');

// Save Playlist Modal elements
const savePlaylistModal = document.getElementById('savePlaylistModal');
const btnSavePlaylistClose = document.getElementById('btnSavePlaylistClose');
const btnCancelSave = document.getElementById('btnCancelSave');
const btnConfirmSave = document.getElementById('btnConfirmSave');
const modalPlaylistName = document.getElementById('modalPlaylistName');
const modalPlaylistDescription = document.getElementById('modalPlaylistDescription');
const privacyPublic = document.getElementById('privacyPublic');
const privacyPrivate = document.getElementById('privacyPrivate');
const modalUploadCover = document.getElementById('modalUploadCover');

// Export Success Modal elements
const successModal = document.getElementById('successModal');
const btnSuccessClose = document.getElementById('btnSuccessClose');
const btnSuccessCloseAction = document.getElementById('btnSuccessCloseAction');
const linkOpenSpotify = document.getElementById('linkOpenSpotify');
const successModalText = document.getElementById('successModalText');

// Pricing Modal elements
const tokenModal = document.getElementById('tokenModal');
const btnTokenClose = document.getElementById('btnTokenClose');
const btnBuyTokens = document.getElementById('btnBuyTokens');
const btnBuyPremium = document.getElementById('btnBuyPremium');

// Initialization
document.addEventListener('DOMContentLoaded', () => {
  checkAuth();
  setupEventListeners();
  setupDeepLinkListener();
  
  // Set initial landing state
  const grid = document.querySelector('.dashboard-grid');
  if (grid) {
    grid.classList.add('landing-state');
  }
});

// Setup event listeners
function setupEventListeners() {
  // Connect Spotify
  if (btnConnectSpotify) {
    btnConnectSpotify.addEventListener('click', connectSpotify);
  }
  
  const btnConnectSpotifyGate = document.getElementById('btnConnectSpotifyGate');
  if (btnConnectSpotifyGate) {
    btnConnectSpotifyGate.addEventListener('click', connectSpotify);
  }

  // Drag and drop events
  dropZone.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', handleFileSelect);

  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
  });

  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('dragover');
  });

  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    if (e.dataTransfer.files.length > 0) {
      processSelectedFile(e.dataTransfer.files[0]);
    }
  });

  // Reset/Upload new
  btnResetImage.addEventListener('click', resetUploader);

  // Generate Playlist click handler
  if (btnGeneratePlaylist) {
    btnGeneratePlaylist.addEventListener('click', () => {
      if (stagedFile) {
        // Set preview image for analysis card
        sourceImagePreview.src = uploadPreview.src;

        // Toggle card screens
        uploadCard.classList.add('hidden');
        analysisCard.classList.remove('hidden');
        analysisLoader.classList.remove('hidden');
        
        const grid = document.querySelector('.dashboard-grid');
        if (grid) {
          grid.classList.remove('landing-state');
          grid.classList.add('preview-state');
        }

        // Trigger processing
        uploadAndProcessImage(stagedFile);
      }
    });
  }

  // Save Playlist
  btnSavePlaylist.addEventListener('click', savePlaylistToSpotify);

  // Import Playlist click handler
  if (btnImportPlaylist) {
    btnImportPlaylist.addEventListener('click', importPlaylistFromUrl);
  }

  // Save Modal events
  if (btnSavePlaylistClose) {
    btnSavePlaylistClose.addEventListener('click', () => savePlaylistModal.classList.add('hidden'));
  }
  if (btnCancelSave) {
    btnCancelSave.addEventListener('click', () => savePlaylistModal.classList.add('hidden'));
  }
  if (btnConfirmSave) {
    btnConfirmSave.addEventListener('click', confirmSavePlaylistToSpotify);
  }

  // Success Modal events
  if (btnSuccessClose) {
    btnSuccessClose.addEventListener('click', () => successModal.classList.add('hidden'));
  }
  if (btnSuccessCloseAction) {
    btnSuccessCloseAction.addEventListener('click', () => successModal.classList.add('hidden'));
  }
  
  // Auth Gate Modal events
  const btnAuthGateClose = document.getElementById('btnAuthGateClose');
  if (btnAuthGateClose) {
    btnAuthGateClose.addEventListener('click', () => document.getElementById('spotifyAuthGateModal').classList.add('hidden'));
  }

  // Share Vibe Card events
  const btnOpenShareCard = document.getElementById('btnOpenShareCard');
  if (btnOpenShareCard) {
    btnOpenShareCard.addEventListener('click', showVibeCard);
  }
  
  const btnOpenShareCardSuccess = document.getElementById('btnOpenShareCardSuccess');
  if (btnOpenShareCardSuccess) {
    btnOpenShareCardSuccess.addEventListener('click', () => {
      successModal.classList.add('hidden');
      showVibeCard();
    });
  }

  const btnVibeCardClose = document.getElementById('btnVibeCardClose');
  if (btnVibeCardClose) {
    btnVibeCardClose.addEventListener('click', () => document.getElementById('vibeCardModal').classList.add('hidden'));
  }

  const btnDownloadVibeCard = document.getElementById('btnDownloadVibeCard');
  if (btnDownloadVibeCard) {
    btnDownloadVibeCard.addEventListener('click', downloadVibeCardImage);
  }

  // Token Modal
  btnTokenClose.addEventListener('click', () => tokenModal.classList.add('hidden'));
  btnBuyTokens.addEventListener('click', purchaseTokens);
  btnBuyPremium.addEventListener('click', upgradePremium);
}

// Fetch Auth State
async function checkAuth() {
  try {
    const res = await apiFetch('/api/auth/me');
    if (res.ok) {
      const data = await res.json();
      authState.loggedIn = data.loggedIn;
      authState.user = data.user;
      renderUserPanel();
    } else {
      renderDisconnectedPanel();
    }
  } catch (error) {
    console.error("Auth check failed:", error);
    renderDisconnectedPanel();
  }
}

// Render User Status
function renderUserPanel() {
  const { user } = authState;
  
  let badgeHtml = '';
  if (user.tier === 'premium') {
    badgeHtml = `<span class="premium-badge">PREMIUM</span>`;
  } else {
    badgeHtml = `<span class="token-badge" id="tokenCountBadge">${user.tokens} Tokens</span>`;
  }

  userPanel.innerHTML = `
    <div class="user-info">
      <span class="user-name">${escapeHtml(user.displayName)}</span>
      <div class="user-meta">
        ${badgeHtml}
        <button class="btn-text" id="btnLogout">Disconnect</button>
      </div>
    </div>
    ${user.tier === 'free' ? '<button class="btn btn-secondary" id="btnShowBilling">Upgrade</button>' : ''}
  `;

  // Attach logout event
  document.getElementById('btnLogout').addEventListener('click', logout);
  
  const showBilling = document.getElementById('btnShowBilling');
  if (showBilling) {
    showBilling.addEventListener('click', () => tokenModal.classList.remove('hidden'));
  }
  
  updatePlaylistBlurState();
}

function renderDisconnectedPanel() {
  userPanel.innerHTML = `
    <button class="btn btn-primary" id="btnConnectSpotify">
      🟢 Connect Spotify
    </button>
  `;
  document.getElementById('btnConnectSpotify').addEventListener('click', connectSpotify);
  
  updatePlaylistBlurState();
}

// Update Playlist Blur State helper
function updatePlaylistBlurState() {
  const playlistCard = document.querySelector('.playlist-card');
  if (playlistCard) {
    const isLocked = !authState.loggedIn || (authState.user && authState.user.tier === 'free' && authState.user.tokens <= 0);
    if (isLocked) {
      playlistCard.classList.add('preview-locked');
    } else {
      playlistCard.classList.remove('preview-locked');
    }
  }
}

// Logout
async function logout() {
  try {
    await apiFetch('/api/auth/logout');
    authState.loggedIn = false;
    authState.user = null;
    renderDisconnectedPanel();
    btnSavePlaylist.classList.add('hidden');
    // Reload page to reset states
    window.location.reload();
  } catch (error) {
    console.error("Logout failed:", error);
  }
}

// Handle Ingestion File Select
function handleFileSelect(e) {
  if (e.target.files.length > 0) {
    processSelectedFile(e.target.files[0]);
  }
}

function processSelectedFile(file) {
  // Validate type
  const validTypes = ['image/jpeg', 'image/png', 'image/webp'];
  if (!validTypes.includes(file.type)) {
    alert("Invalid file format. Please upload JPEG, PNG or WebP.");
    return;
  }

  // Stage the file
  stagedFile = file;

  // Render client image preview inside drop zone
  const url = URL.createObjectURL(file);
  uploadPreview.src = url;
  uploadPreview.classList.remove('hidden');
  
  // Hide drop zone text
  dropZoneContent.classList.add('hidden');

  // Show Generate button
  btnGeneratePlaylist.classList.remove('hidden');
}

// Reset Image Upload
function resetUploader() {
  fileInput.value = '';
  stagedFile = null;
  sourceImagePreview.src = '';
  
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }
  activeTrack = null;
  if (spotifyPlayerContainer) {
    spotifyPlayerContainer.innerHTML = '';
  }
  
  if (uploadPreview) {
    uploadPreview.src = '';
    uploadPreview.classList.add('hidden');
  }

  if (dropZoneContent) {
    dropZoneContent.classList.remove('hidden');
  }

  if (btnGeneratePlaylist) {
    btnGeneratePlaylist.classList.add('hidden');
  }

  const customPromptInput = document.getElementById('customTextPrompt');
  if (customPromptInput) {
    customPromptInput.value = '';
  }
  
  if (importCard) {
    importCard.classList.remove('hidden');
  }
  if (importUrlInput) {
    importUrlInput.value = '';
  }

  analysisCard.classList.add('hidden');
  uploadCard.classList.remove('hidden');
  
  const grid = document.querySelector('.dashboard-grid');
  if (grid) {
    grid.classList.add('landing-state');
    grid.classList.remove('preview-state');
  }
  
  const btnOpenShareCard = document.getElementById('btnOpenShareCard');
  if (btnOpenShareCard) {
    btnOpenShareCard.classList.add('hidden');
  }
  
  // Reset tracklist
  tracklistContainer.innerHTML = `
    <div class="tracklist-placeholder">
      <div class="placeholder-icon"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="svg-icon"><path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle></svg></div>
      <p>Your recommendations will appear here</p>
    </div>
  `;
  playlistStatusText.textContent = "Upload an image to generate recommended tracks";
  btnSavePlaylist.classList.add('hidden');
  
  if (spotifyPlayerContainer) {
    spotifyPlayerContainer.classList.add('hidden');
    spotifyPlayerContainer.innerHTML = '';
  }
  activeTrack = null;

  currentGeneration = {
    id: null,
    imagePath: null,
    metadata: null,
    tracks: []
  };
}

// Import Existing Spotify Playlist by URL/URI
async function importPlaylistFromUrl() {
  if (!importUrlInput || !btnImportPlaylist) return;
  const urlVal = importUrlInput.value.trim();
  if (!urlVal) {
    alert("Please paste a Spotify playlist link.");
    return;
  }

  btnImportPlaylist.disabled = true;
  btnImportPlaylist.textContent = "Importing...";

  try {
    const res = await apiFetch('/api/playlist/import', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ playlistUrl: urlVal })
    });

    if (!res.ok) {
      const errData = await res.json();
      throw new Error(errData.message || "Failed to import playlist.");
    }

    const result = await res.json();
    
    // Set current generation state
    currentGeneration.id = null; // Stays null since we didn't perform a vision extraction
    currentGeneration.imagePath = null;
    currentGeneration.metadata = result.metadata;
    currentGeneration.tracks = result.tracks;

    // Transition UI views
    uploadCard.classList.add('hidden');
    if (importCard) {
      importCard.classList.add('hidden');
    }
    analysisCard.classList.remove('hidden');
    analysisLoader.classList.add('hidden'); // Bypass vision scan animations
    
    const grid = document.querySelector('.dashboard-grid');
    if (grid) {
      grid.classList.remove('landing-state');
      grid.classList.add('preview-state');
    }

    if (result.coverUrl) {
      sourceImagePreview.src = result.coverUrl;
    } else {
      sourceImagePreview.src = 'https://via.placeholder.com/300?text=Imported+Playlist';
    }

    // Render results
    renderAnalysisResults(result.metadata);
    renderTracks(result.tracks);

    // Show save option if user is logged in
    if (authState.loggedIn) {
      btnSavePlaylist.classList.remove('hidden');
      btnSavePlaylist.textContent = "Clone Playlist to Spotify";
      btnSavePlaylist.disabled = false;
    } else {
      playlistStatusText.textContent = "Connect Spotify to clone this playlist to your library";
    }

  } catch (error) {
    console.error("Import failure:", error);
    alert(error.message);
  } finally {
    btnImportPlaylist.disabled = false;
    btnImportPlaylist.textContent = "📥 Import Playlist";
  }
}

// Upload & Process Core pipeline endpoint
async function uploadAndProcessImage(file) {
  const formData = new FormData();
  formData.append('image', file);

  const customPromptInput = document.getElementById('customTextPrompt');
  if (customPromptInput && customPromptInput.value.trim()) {
    formData.append('customPrompt', customPromptInput.value.trim());
  }

  try {
    const res = await apiFetch('/api/playlist/process', {
      method: 'POST',
      body: formData
    });

    if (!res.ok) {
      const errData = await res.json();
      if (res.status === 403) {
        // Token limit hit
        tokenModal.classList.remove('hidden');
      }
      throw new Error(errData.message || "Failed to process image.");
    }

    const result = await res.json();
    currentGeneration.id = result.generationId;
    currentGeneration.imagePath = result.imagePath;
    currentGeneration.metadata = result.metadata;
    currentGeneration.tracks = result.tracks;

    // Refresh user tokens if logged in
    if (authState.loggedIn) {
      checkAuth();
    }

    // Render results
    renderAnalysisResults(result.metadata);
    renderTracks(result.tracks);

    // Always show Save to Spotify and Share Vibe buttons to trigger inverted onboarding auth gate
    btnSavePlaylist.classList.remove('hidden');
    btnSavePlaylist.textContent = "Save Playlist to Spotify";
    btnSavePlaylist.disabled = false;
    
    const btnOpenShareCard = document.getElementById('btnOpenShareCard');
    if (btnOpenShareCard) {
      btnOpenShareCard.classList.remove('hidden');
    }
    
    if (!authState.loggedIn) {
      playlistStatusText.textContent = "Connect Spotify to export your visual playlist";
    }

  } catch (error) {
    console.error("Pipeline failure:", error);
    alert(error.message);
    resetUploader();
  } finally {
    analysisLoader.classList.add('hidden');
  }
}

// Render Gemini visual metadata outputs
function renderAnalysisResults(metadata) {
  // Dominant colors
  colorTags.innerHTML = '';
  metadata.dominantColorPalette.forEach(color => {
    const tag = document.createElement('span');
    tag.className = 'tag color-tag';
    // Style left border color based on typical aesthetic keywords or basic matching
    tag.style.borderLeftColor = getTagColorHex(color);
    tag.textContent = color;
    colorTags.appendChild(tag);
  });

  // Environmental and Emotional context
  envContext.textContent = metadata.environmentalContext;
  emotionalVibe.textContent = metadata.emotionalVibe;

  // Sliders
  valValence.textContent = metadata.valence.toFixed(2);
  barValence.style.width = `${metadata.valence * 100}%`;
  
  valEnergy.textContent = metadata.energy.toFixed(2);
  barEnergy.style.width = `${metadata.energy * 100}%`;

  valAcousticness.textContent = metadata.acousticness.toFixed(2);
  barAcousticness.style.width = `${metadata.acousticness * 100}%`;

  // Seed genres
  genreTags.innerHTML = '';
  metadata.seedGenres.forEach(genre => {
    const tag = document.createElement('span');
    tag.className = 'tag genre-tag';
    tag.textContent = genre;
    genreTags.appendChild(tag);
  });
}

// Helper to determine border accent based on color string
function getTagColorHex(colorName) {
  const cn = colorName.toLowerCase();
  if (cn.includes('blue') || cn.includes('neon')) return '#00f2fe';
  if (cn.includes('purple') || cn.includes('cyber')) return '#9b51e0';
  if (cn.includes('pink') || cn.includes('pastel')) return '#ff758c';
  if (cn.includes('red') || cn.includes('vintage')) return '#ff4b4b';
  if (cn.includes('yellow') || cn.includes('warm')) return '#fbc2eb';
  if (cn.includes('green') || cn.includes('nature')) return '#1db954';
  if (cn.includes('monochrome') || cn.includes('dark')) return '#8e95b2';
  return '#ffffff';
}

// Render Track recommendations list
function renderTracks(tracks) {
  tracklistContainer.innerHTML = '';
  updatePlaylistBlurState();
  
  if (tracks.length === 0) {
    tracklistContainer.innerHTML = `
      <div class="tracklist-placeholder">
        <p>No recommendations found for this aesthetic setup.</p>
      </div>
    `;
    playlistStatusText.textContent = "Try uploading a different image.";
    return;
  }

  playlistStatusText.textContent = `Aesthetic mapping resolved ${tracks.length} songs`;

  tracks.forEach((track, index) => {
    const trackCard = document.createElement('div');
    trackCard.className = 'track-card';
    trackCard.id = `track-${track.id}`;

    const coverUrl = track.album.images && track.album.images.length > 2 
      ? track.album.images[2].url 
      : 'https://via.placeholder.com/48';

    const artists = track.artists.map(a => a.name).join(', ');
    const duration = formatDuration(track.duration_ms);

    trackCard.innerHTML = `
      <div class="track-main-info" onclick="togglePlayTrack('${track.id}')">
        <span class="track-index">${index + 1}</span>
        <img class="track-cover" src="${coverUrl}" alt="Album Cover">
        <div class="track-text">
          <h4 class="track-title">${escapeHtml(track.name)}</h4>
          <p class="track-artist">${escapeHtml(artists)}</p>
        </div>
        <span class="track-album">${escapeHtml(track.album.name)}</span>
      </div>
      
      <div class="track-controls">
        <span class="track-duration">${duration}</span>
        <button class="btn-play-preview" onclick="togglePlayTrack('${track.id}')" title="Play on Spotify">▶</button>
      </div>
    `;

    tracklistContainer.appendChild(trackCard);
  });
}

// Toggle Play track via Spotify Embed / Native Audio
window.togglePlayTrack = function(trackId) {
  const track = currentGeneration.tracks.find(t => t.id === trackId);
  if (!track) return;

  const card = document.getElementById(`track-${trackId}`);

  // Pause and reset existing audio instance if playing
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }

  if (activeTrack === trackId) {
    card.classList.remove('active');
    spotifyPlayerContainer.classList.add('hidden');
    spotifyPlayerContainer.innerHTML = '';
    activeTrack = null;
  } else {
    // Stop active track visually
    if (activeTrack) {
      const activeCard = document.getElementById(`track-${activeTrack}`);
      if (activeCard) {
        activeCard.classList.remove('active');
      }
    }

    // Play new visually
    card.classList.add('active');
    activeTrack = trackId;

    if (track.preview_url) {
      // Play native audio with custom volume controls
      currentAudio = new Audio(track.preview_url);
      currentAudio.volume = currentAudioVolume;
      currentAudio.play().catch(err => {
        console.warn("Failed to play preview audio natively:", err);
      });

      currentAudio.onended = () => {
        card.classList.remove('active');
        spotifyPlayerContainer.classList.add('hidden');
        spotifyPlayerContainer.innerHTML = '';
        activeTrack = null;
      };

      spotifyPlayerContainer.innerHTML = `
        <div class="custom-audio-player">
          <div class="player-info">
            <span class="player-label">🎵 Previewing Track</span>
            <span class="player-track-name">${track.name} - ${track.artists.map(a => a.name).join(', ')}</span>
          </div>
          <div class="player-volume-control">
            <span class="volume-icon">🔊</span>
            <input type="range" min="0" max="1" step="0.05" value="${currentAudioVolume}" id="previewVolumeSlider" class="volume-slider">
          </div>
        </div>
      `;

      const slider = document.getElementById('previewVolumeSlider');
      if (slider) {
        slider.addEventListener('input', (e) => {
          currentAudioVolume = parseFloat(e.target.value);
          if (currentAudio) {
            currentAudio.volume = currentAudioVolume;
          }
        });
      }
    } else {
      // Load Spotify Playback Widget iframe
      spotifyPlayerContainer.innerHTML = `
        <div class="iframe-player-wrapper">
          <iframe src="https://open.spotify.com/embed/track/${trackId}?utm_source=generator&theme=0" 
            width="100%" 
            height="80" 
            frameBorder="0" 
            allowfullscreen="" 
            allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" 
            loading="lazy">
          </iframe>
          <div class="iframe-volume-note">
            Volume controlled via your device or Spotify app
          </div>
        </div>
      `;
    }
    spotifyPlayerContainer.classList.remove('hidden');
  }
};

// Open Save Playlist Modal
async function savePlaylistToSpotify() {
  if (!currentGeneration.tracks.length) return;

  if (!authState.loggedIn) {
    // Inverted Onboarding Trigger: Open Spotify Auth Gate Modal instead of configuration form
    document.getElementById('spotifyAuthGateModal').classList.remove('hidden');
    return;
  }

  const vibeName = currentGeneration.metadata ? currentGeneration.metadata.emotionalVibe : "Visual Vibe";
  const defaultPlaylistName = `${vibeName} - Moment.AI`;
  const defaultDescription = `Visual playlist based on dominant colors: ${currentGeneration.metadata ? currentGeneration.metadata.dominantColorPalette.join(', ') : ''} and vibe: ${vibeName}. Generated by Moment.AI.`;

  // Prefill form
  modalPlaylistName.value = defaultPlaylistName;
  modalPlaylistDescription.value = defaultDescription;
  privacyPublic.checked = true;
  modalUploadCover.checked = true;

  // Open modal
  savePlaylistModal.classList.remove('hidden');
}

// Client-side canvas-resizing logic to convert image to 500x500 square JPEG under 256KB
function getResizedCoverArtBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = function (event) {
      const img = new Image();
      img.onload = function () {
        const canvas = document.createElement('canvas');
        canvas.width = 500;
        canvas.height = 500;
        const ctx = canvas.getContext('2d');
        
        // Crop image to center square
        const minSize = Math.min(img.width, img.height);
        const sx = (img.width - minSize) / 2;
        const sy = (img.height - minSize) / 2;
        
        ctx.drawImage(img, sx, sy, minSize, minSize, 0, 0, 500, 500);
        
        // Export to JPEG with 0.8 quality
        const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
        const base64Str = dataUrl.split(',')[1];
        resolve(base64Str);
      };
      img.onerror = function (err) {
        reject(new Error("Failed to load image for resizing"));
      };
      img.src = event.target.result;
    };
    reader.onerror = function (err) {
      reject(new Error("Failed to read image file"));
    };
    reader.readAsDataURL(file);
  });
}

// Show custom success modal
function showExportSuccessModal(playlistName, url) {
  successModalText.textContent = `Playlist "${playlistName}" was created successfully on your Spotify account!`;
  linkOpenSpotify.href = url;
  successModal.classList.remove('hidden');
}

// Confirm Save Playlist to Spotify Account
async function confirmSavePlaylistToSpotify() {
  const playlistName = modalPlaylistName.value.trim();
  const playlistDescription = modalPlaylistDescription.value.trim();
  const isPublic = privacyPublic.checked;
  const uploadCover = modalUploadCover.checked;

  if (!playlistName) {
    alert("Please enter a playlist name.");
    return;
  }

  // Close Save Modal first
  savePlaylistModal.classList.add('hidden');

  btnSavePlaylist.disabled = true;
  btnSavePlaylist.textContent = "Saving to Spotify...";

  const trackUris = currentGeneration.tracks.map(t => t.uri);
  
  let coverImageBase64 = null;
  if (uploadCover && stagedFile) {
    try {
      btnSavePlaylist.textContent = "Compressing cover art...";
      coverImageBase64 = await getResizedCoverArtBase64(stagedFile);
    } catch (resizeErr) {
      console.warn("Client-side cover art compression failed, proceeding without custom cover:", resizeErr);
    }
  }

  btnSavePlaylist.textContent = "Exporting to Spotify...";

  try {
    const res = await apiFetch('/api/playlist/save', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        playlistName: playlistName,
        playlistDescription: playlistDescription,
        isPublic: isPublic,
        trackUris: trackUris,
        generationId: currentGeneration.id,
        coverImageBase64: coverImageBase64
      })
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.message || "Failed to save playlist.");
    }

    btnSavePlaylist.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="svg-icon"><polyline points="20 6 9 17 4 12"></polyline></svg> Saved`;
    btnSavePlaylist.className = 'btn btn-secondary';
    
    showExportSuccessModal(playlistName, data.playlistUrl);

  } catch (error) {
    console.error("Save failed:", error);
    alert(error.message);
    btnSavePlaylist.disabled = false;
    btnSavePlaylist.textContent = "Save Playlist to Spotify";
  }
}

// Purchase Mock Tokens
async function purchaseTokens() {
  btnBuyTokens.disabled = true;
  btnBuyTokens.textContent = "Processing...";

  try {
    const res = await apiFetch('/api/payment/purchase-tokens', { method: 'POST' });
    const data = await res.json();
    
    if (res.ok) {
      alert(data.message);
      tokenModal.classList.add('hidden');
      checkAuth(); // update badges
    } else {
      throw new Error(data.message);
    }
  } catch (error) {
    alert(error.message);
  } finally {
    btnBuyTokens.disabled = false;
    btnBuyTokens.textContent = "Purchase Pack";
  }
}

// Upgrade Premium Mock
async function upgradePremium() {
  btnBuyPremium.disabled = true;
  btnBuyPremium.textContent = "Processing...";

  try {
    const res = await apiFetch('/api/payment/subscribe', { method: 'POST' });
    const data = await res.json();
    
    if (res.ok) {
      alert(data.message);
      tokenModal.classList.add('hidden');
      checkAuth(); // update badges
    } else {
      throw new Error(data.message);
    }
  } catch (error) {
    alert(error.message);
  } finally {
    btnBuyPremium.disabled = false;
    btnBuyPremium.textContent = "Upgrade to Premium";
  }
}

// Helper Utilities
function formatDuration(ms) {
  const minutes = Math.floor(ms / 60000);
  const seconds = ((ms % 60000) / 1000).toFixed(0);
  return minutes + ":" + (seconds < 10 ? '0' : '') + seconds;
}

function escapeHtml(string) {
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return String(string).replace(/[&<>"']/g, function(m) { return map[m]; });
}

// Mobile Login Trigger helper
function connectSpotify() {
  const loginUrl = `${API_BASE}/api/auth/login?platform=mobile`;
  
  if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Browser) {
    window.Capacitor.Plugins.Browser.open({ url: loginUrl });
  } else {
    // Web redirect fallback
    window.location.href = API_BASE ? loginUrl : '/api/auth/login';
  }
}

// Register deep link listener to handle Spotify OAuth redirects back to the mobile app
function setupDeepLinkListener() {
  if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App) {
    window.Capacitor.Plugins.App.addListener('appUrlOpen', async (event) => {
      console.log('App opened with URL:', event.url);
      
      // Close mobile in-app browser sheet if it is still open
      if (window.Capacitor.Plugins.Browser) {
        await window.Capacitor.Plugins.Browser.close();
      }
      
      try {
        const url = new URL(event.url);
        // Deep link structure: playlistpic://auth-callback?spotify_user_id=...
        if (url.host === 'auth-callback' || url.pathname.includes('auth-callback')) {
          const userId = url.searchParams.get('spotify_user_id');
          if (userId) {
            // Set cookie in local webview environment
            document.cookie = `spotify_user_id=${userId}; path=/; max-age=${30 * 24 * 60 * 60};`;
            // Refresh authentication state
            checkAuth();
          }
        }
      } catch (err) {
        console.error('Failed to parse app deep link:', err);
      }
    });
  }
}

// Show Vibe Card
function showVibeCard() {
  if (!currentGeneration.tracks.length) return;
  
  const vibeCardModal = document.getElementById('vibeCardModal');
  const vibeCardImage = document.getElementById('vibeCardImage');
  const vibeCardBlurBg = document.getElementById('vibeCardBlurBg');
  const vibeCardAesthetic = document.getElementById('vibeCardAesthetic');
  const vibeCardMetrics = document.getElementById('vibeCardMetrics');
  const vibeCardTitle = document.getElementById('vibeCardTitle');
  const vibeCardLink = document.getElementById('vibeCardLink');
  const vibeCardCover = document.getElementById('vibeCardCover');
  
  // Populate Image
  if (stagedFile) {
    const url = URL.createObjectURL(stagedFile);
    vibeCardImage.src = url;
    vibeCardBlurBg.style.backgroundImage = `url(${url})`;
  } else if (sourceImagePreview.src) {
    vibeCardImage.src = sourceImagePreview.src;
    vibeCardBlurBg.style.backgroundImage = `url(${sourceImagePreview.src})`;
  }
  
  // Populate Aesthetic Profile Text
  if (currentGeneration.metadata) {
    const meta = currentGeneration.metadata;
    const mood = meta.emotionalVibe || 'Visual Vibe';
    vibeCardAesthetic.textContent = `Aesthetic: ${mood}`;
    vibeCardMetrics.textContent = `⚡ ${(meta.energy * 100).toFixed(0)}% Energy  •  🌙 ${(meta.valence * 100).toFixed(0)}% Mood`;
    vibeCardTitle.textContent = `${mood} Mood Playlist`;
  } else {
    vibeCardAesthetic.textContent = "Aesthetic: Electric Indie";
    vibeCardMetrics.textContent = "⚡ 94% Neon Energy  •  🌙 88% Midnight Mood";
    vibeCardTitle.textContent = "Moment AI Playlist";
  }
  
  // Cover Art
  if (currentGeneration.tracks.length > 0 && currentGeneration.tracks[0].album.images && currentGeneration.tracks[0].album.images.length > 0) {
    vibeCardCover.style.backgroundImage = `url(${currentGeneration.tracks[0].album.images[0].url})`;
  } else {
    vibeCardCover.style.backgroundImage = 'none';
  }
  
  // Set Link
  const genId = currentGeneration.id || 'preview';
  vibeCardLink.textContent = `moment-ai.app/vibe/${genId}`;
  
  vibeCardModal.classList.remove('hidden');
}

// Download Vibe Card Image (Canvas Renderer)
function downloadVibeCardImage() {
  const canvas = document.createElement('canvas');
  canvas.width = 1080;
  canvas.height = 1920;
  const ctx = canvas.getContext('2d');
  
  // 1. Draw solid dark background
  ctx.fillStyle = '#070913';
  ctx.fillRect(0, 0, 1080, 1920);
  
  // 2. Draw ambient purple/indigo background glow
  const grad = ctx.createRadialGradient(540, 960, 100, 540, 960, 800);
  grad.addColorStop(0, '#7B2CBF');
  grad.addColorStop(1, '#070913');
  ctx.fillStyle = grad;
  ctx.globalAlpha = 0.35;
  ctx.fillRect(0, 0, 1080, 1920);
  ctx.globalAlpha = 1.0;
  
  // 3. Draw main moment photo inside rounded clipping path
  const imgElement = document.getElementById('vibeCardImage');
  
  const drawRemainingElements = () => {
    // Draw overlay badges on the photo
    ctx.save();
    const badgeText = document.getElementById('vibeCardAesthetic').textContent;
    const subbadgeText = document.getElementById('vibeCardMetrics').textContent;
    
    // Aesthetic Badge Background
    ctx.fillStyle = 'rgba(13, 13, 17, 0.9)';
    ctx.beginPath();
    ctx.roundRect(140, 1100, 480, 70, 35);
    ctx.fill();
    
    // Aesthetic Badge Text
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 28px Inter, sans-serif';
    ctx.fillText(badgeText, 170, 1145);
    
    // Metrics Badge Background
    ctx.fillStyle = '#7B2CBF';
    ctx.beginPath();
    ctx.roundRect(140, 1190, 600, 60, 30);
    ctx.fill();
    
    // Metrics Badge Text
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 20px Inter, sans-serif';
    ctx.fillText(subbadgeText, 170, 1228);
    ctx.restore();

    // 4. Draw footer card
    ctx.save();
    ctx.fillStyle = 'rgba(24, 24, 34, 0.9)';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 2;
    
    const fx = 80;
    const fy = 1480;
    const fw = 920;
    const fh = 240;
    const fr = 32;
    
    ctx.beginPath();
    ctx.moveTo(fx + fr, fy);
    ctx.lineTo(fx + fw - fr, fy);
    ctx.quadraticCurveTo(fx + fw, fy, fx + fw, fy + fr);
    ctx.lineTo(fx + fw, fy + fh - fr);
    ctx.quadraticCurveTo(fx + fw, fy + fh, fx + fw - fr, fy + fh);
    ctx.lineTo(fx + fr, fy + fh);
    ctx.quadraticCurveTo(fx, fy + fh, fx, fy + fh - fr);
    ctx.lineTo(fx, fy + fr);
    ctx.quadraticCurveTo(fx, fy, fx + fr, fy);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    
    // Draw footer cover art
    ctx.fillStyle = '#7B2CBF';
    ctx.beginPath();
    ctx.roundRect(130, 1520, 160, 160, 16);
    ctx.fill();
    
    // Check if album art image is loaded in current page
    const firstCoverElement = document.querySelector('.track-cover');
    if (firstCoverElement && firstCoverElement.complete && firstCoverElement.naturalWidth) {
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(130, 1520, 160, 160, 16);
      ctx.clip();
      ctx.drawImage(firstCoverElement, 130, 1520, 160, 160);
      ctx.restore();
    } else {
      // Mock music note indicator
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.arc(200, 1610, 15, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(210, 1550, 10, 60);
      ctx.fillRect(210, 1550, 40, 10);
    }
    
    // Draw texts in footer
    const playlistTitleText = document.getElementById('vibeCardTitle').textContent;
    const appLinkText = document.getElementById('vibeCardLink').textContent;
    
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 36px Outfit, sans-serif';
    ctx.fillText(playlistTitleText, 320, 1580);
    
    ctx.fillStyle = '#8E8E9F';
    ctx.font = '24px Inter, sans-serif';
    ctx.fillText(appLinkText, 320, 1635);
    
    // Add branding tag
    ctx.fillStyle = 'rgba(29, 185, 84, 0.15)';
    ctx.beginPath();
    ctx.roundRect(750, 1570, 180, 60, 30);
    ctx.fill();
    
    ctx.fillStyle = '#1DB954';
    ctx.font = 'bold 22px Inter, sans-serif';
    ctx.fillText('Moment.AI', 780, 1608);
    ctx.restore();
    
    // 5. Trigger download link
    const link = document.createElement('a');
    link.download = `moment-ai-vibe-${currentGeneration.id || 'share'}.jpg`;
    link.href = canvas.toDataURL('image/jpeg', 0.95);
    link.click();
  };

  if (imgElement && imgElement.src) {
    // If image is loaded, draw it
    const tempImg = new Image();
    tempImg.crossOrigin = 'anonymous'; // Enable CORS if loaded from remote source
    tempImg.onload = function() {
      ctx.save();
      
      const rx = 80;
      const ry = 150;
      const rw = 920;
      const rh = 1240;
      const radius = 40;
      
      ctx.beginPath();
      ctx.moveTo(rx + radius, ry);
      ctx.lineTo(rx + rw - radius, ry);
      ctx.quadraticCurveTo(rx + rw, ry, rx + rw, ry + radius);
      ctx.lineTo(rx + rw, ry + rh - radius);
      ctx.quadraticCurveTo(rx + rw, ry + rh, rx + rw - radius, ry + rh);
      ctx.lineTo(rx + radius, ry + rh);
      ctx.quadraticCurveTo(rx, ry + rh, rx, ry + rh - radius);
      ctx.lineTo(rx, ry + radius);
      ctx.quadraticCurveTo(rx, ry, rx + radius, ry);
      ctx.closePath();
      ctx.clip();
      
      ctx.drawImage(tempImg, rx, ry, rw, rh);
      ctx.restore();
      
      drawRemainingElements();
    };
    tempImg.onerror = function() {
      // Fallback if image fails to load
      ctx.fillStyle = '#1F1F2C';
      ctx.beginPath();
      ctx.roundRect(80, 150, 920, 1240, 40);
      ctx.fill();
      drawRemainingElements();
    };
    tempImg.src = imgElement.src;
  } else {
    // Fallback if no image
    ctx.fillStyle = '#1F1F2C';
    ctx.beginPath();
    ctx.roundRect(80, 150, 920, 1240, 40);
    ctx.fill();
    drawRemainingElements();
  }
}
