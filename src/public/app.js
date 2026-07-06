// Base API URL configuration
import {
  hidePanel,
  runViewTransition,
  setButtonLoading,
  showPanel,
  staggerIn,
  toggleModal,
  transitionToLanding,
  transitionToPreview
} from './animations.js';

// If running in Capacitor (protocol is capacitor: or hostname is localhost with no port),
// point to the hosted backend. Otherwise, use relative paths.
const API_BASE = (
  window.location.protocol === 'capacitor:' ||
  (window.location.hostname === 'localhost' && !window.location.port)
)
  ? 'https://momentai.dev'
  : '';

// ─── Supabase Auth Client ─────────────────────────────────────────────────────
let supabase = null;
let supabaseAccessToken = null;
let authInitialized = false;
let authInitPromise = null;

// Helper wrapper for fetches — includes Supabase JWT in Authorization header
async function apiFetch(path, options = {}) {
  const url = `${API_BASE}${path}`;
  options.credentials = 'include';
  if (!options.headers) options.headers = {};
  if (supabaseAccessToken) {
    if (options.headers instanceof Headers) {
      options.headers.set('Authorization', `Bearer ${supabaseAccessToken}`);
    } else {
      options.headers['Authorization'] = `Bearer ${supabaseAccessToken}`;
    }
  }
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
  tracks: [],
  suggestedTracks: [],
  customPrompt: ''
};

let activeTrack = null;
let stagedFile = null;
let currentAudio = null;
let currentAudioVolume = 0.5;

// DOM Elements
const userPanel = document.getElementById('userPanel');
const btnSignIn = document.getElementById('btnSignIn');
const uploadCard = document.getElementById('uploadCard');
const landingStack = document.getElementById('landingStack');
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
const suggestionsPanel = document.getElementById('suggestionsPanel');
const suggestionsList = document.getElementById('suggestionsList');
const btnLoadMoreSuggestions = document.getElementById('btnLoadMoreSuggestions');
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
const signInGateModal = document.getElementById('signInGateModal');
const btnUploadMoment = document.getElementById('btnUploadMoment');
const btnNewPhoto = document.getElementById('btnNewPhoto');
const aestheticTitle = document.getElementById('aestheticTitle');
const metricEnergy = document.getElementById('metricEnergy');
const metricMood = document.getElementById('metricMood');
const colorSwatches = document.getElementById('colorSwatches');
const genresLabel = document.getElementById('genresLabel');

function updateChromeState(isPreview) {
  document.querySelectorAll('.landing-only').forEach((el) => {
    el.classList.toggle('hidden', isPreview);
  });
  document.querySelectorAll('.preview-only').forEach((el) => {
    el.classList.toggle('hidden', !isPreview);
  });
  document.body.classList.toggle('is-preview', isPreview);
}

function showPreviewCtas() {
  if (btnSavePlaylist) btnSavePlaylist.classList.remove('hidden');
  if (btnNewPhoto) btnNewPhoto.classList.remove('hidden');
}

function hidePreviewCtas() {
  if (btnSavePlaylist) btnSavePlaylist.classList.add('hidden');
  if (btnNewPhoto) btnNewPhoto.classList.add('hidden');
}

// Initialization
document.addEventListener('DOMContentLoaded', async () => {
  await initSupabaseAuth();
  setupEventListeners();
  setupDeepLinkListener();
  handlePaymentReturn();
  
  const grid = document.querySelector('.dashboard-grid');
  if (grid) {
    grid.classList.add('landing-state');
  }

  const rightPanel = document.querySelector('.right-panel');
  if (rightPanel) {
    rightPanel.classList.remove('is-visible');
  }

  updateChromeState(false);
  staggerIn(document.querySelector('.steps-grid'), '.step-card', 80);
});

// Setup event listeners
function setupEventListeners() {
  // Sign in
  if (btnSignIn) {
    btnSignIn.addEventListener('click', () => openAuthModal('signin'));
  }

  // Drag and drop events
  dropZone.addEventListener('click', (e) => {
    if (!authState.loggedIn) {
      e.preventDefault();
      openAuthModal('signup');
    } else {
      fileInput.click();
    }
  });
  fileInput.addEventListener('change', handleFileSelect);

  if (btnUploadMoment) {
    btnUploadMoment.addEventListener('click', (e) => {
      if (!authState.loggedIn) {
        e.preventDefault();
        openAuthModal('signup');
      } else {
        fileInput.click();
      }
    });
  }

  if (btnNewPhoto) {
    btnNewPhoto.addEventListener('click', () => resetUploader());
  }

  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (!dropZone.classList.contains('dragover')) {
      dropZone.classList.add('dragover');
    }
  });

  dropZone.addEventListener('dragleave', (e) => {
    if (!dropZone.contains(e.relatedTarget)) {
      dropZone.classList.remove('dragover');
    }
  });

  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    if (!authState.loggedIn) {
      openAuthModal('signup');
      return;
    }
    if (e.dataTransfer.files.length > 0) {
      processSelectedFile(e.dataTransfer.files[0]);
    }
  });

  // Reset/Upload new
  btnResetImage.addEventListener('click', resetUploader);

  // Generate Playlist click handler
  if (btnGeneratePlaylist) {
    btnGeneratePlaylist.addEventListener('click', async () => {
      if (stagedFile) {
        sourceImagePreview.src = uploadPreview.src;

        const grid = document.querySelector('.dashboard-grid');
        setButtonLoading(btnGeneratePlaylist, true);

        await transitionToPreview({
          grid,
          landingStack,
          analysisCard,
          analysisLoader,
          showLoader: true
        });
        updateChromeState(true);

        await uploadAndProcessImage(stagedFile);
      }
    });
  }

  // Save Playlist
  btnSavePlaylist.addEventListener('click', savePlaylistToSpotify);

  if (tracklistContainer) {
    tracklistContainer.addEventListener('click', handlePlaylistTrackClick);
  }

  if (suggestionsList) {
    suggestionsList.addEventListener('click', handleSuggestionTrackClick);
  }

  if (btnLoadMoreSuggestions) {
    btnLoadMoreSuggestions.addEventListener('click', loadMoreSuggestions);
  }

  // Import Playlist click handler
  if (btnImportPlaylist) {
    btnImportPlaylist.addEventListener('click', importPlaylistFromUrl);
  }

  // Save Modal events
  if (btnSavePlaylistClose) {
    btnSavePlaylistClose.addEventListener('click', () => toggleModal(savePlaylistModal, false));
  }
  if (btnCancelSave) {
    btnCancelSave.addEventListener('click', () => toggleModal(savePlaylistModal, false));
  }
  if (btnConfirmSave) {
    btnConfirmSave.addEventListener('click', confirmSavePlaylistToSpotify);
  }

  // Success Modal events
  if (btnSuccessClose) {
    btnSuccessClose.addEventListener('click', () => toggleModal(successModal, false));
  }
  if (btnSuccessCloseAction) {
    btnSuccessCloseAction.addEventListener('click', () => toggleModal(successModal, false));
  }
  
  const btnAuthGateClose = document.getElementById('btnAuthGateClose');
  if (btnAuthGateClose) {
    btnAuthGateClose.addEventListener('click', () => toggleModal(signInGateModal, false));
  }

  // Email Auth Modal Events
  const authForm = document.getElementById('authForm');
  if (authForm) {
    authForm.addEventListener('submit', handleAuthSubmit);
  }

  const btnToggleAuthMode = document.getElementById('btnToggleAuthMode');
  if (btnToggleAuthMode) {
    btnToggleAuthMode.addEventListener('click', toggleAuthMode);
  }

  btnTokenClose.addEventListener('click', () => toggleModal(tokenModal, false));
  btnBuyTokens.addEventListener('click', purchaseTokens);
  btnBuyPremium.addEventListener('click', upgradePremium);
}

// Initialize Supabase Auth and check for existing session
async function initSupabaseAuth() {
  if (authInitPromise) {
    return authInitPromise;
  }

  authInitPromise = (async () => {
  // Fetch Supabase configuration from backend config endpoint
    try {
      const configRes = await fetch(`${API_BASE}/api/auth/config`);
      if (!configRes.ok) {
        throw new Error('Failed to fetch Auth config from backend');
      }
      const config = await configRes.json();
      if (!config.supabaseUrl || !config.supabaseAnonKey) {
        console.warn('Supabase URL or Anon Key is missing from config endpoints.');
        renderDisconnectedPanel();
        return;
      }
      
      // Dynamically initialize Supabase client if window.supabase is available
      if (window.supabase && !supabase) {
        supabase = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey);
      }
    } catch (err) {
      console.error('Failed to configure Supabase Auth client:', err);
      renderDisconnectedPanel();
      return;
    }

    if (!supabase) {
      console.warn('Supabase client not initialized');
      renderDisconnectedPanel();
      return;
    }

    if (!authInitialized) {
      // Listen for auth state changes (login, logout, token refresh)
      supabase.auth.onAuthStateChange(async (event, session) => {
        console.log('Auth state change:', event);
        if (session) {
          supabaseAccessToken = session.access_token;
          await syncUserWithBackend();
        } else {
          supabaseAccessToken = null;
          authState.loggedIn = false;
          authState.user = null;
          renderDisconnectedPanel();
        }
      });
      authInitialized = true;
    }

    // Check for existing session on page load
    const { data: { session } } = await supabase.auth.getSession();
    if (session) {
      supabaseAccessToken = session.access_token;
      await syncUserWithBackend();
    } else {
      renderDisconnectedPanel();
    }
  })();

  try {
    await authInitPromise;
  } finally {
    authInitPromise = null;
  }
}

// Sync Supabase user with our backend database
async function syncUserWithBackend() {
  try {
    // First, upsert the user via callback
    await apiFetch('/api/auth/callback', { method: 'POST' });

    // Then fetch the user profile
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
    console.error('Backend sync failed:', error);
    renderDisconnectedPanel();
  }
}

let currentAuthMode = 'signin';

// Open the Email Auth Modal
async function openAuthModal(mode = 'signin') {
  currentAuthMode = mode;
  updateAuthModalUI();
  await toggleModal(signInGateModal, true);
}

// Toggle between Sign In and Sign Up modes
function toggleAuthMode() {
  currentAuthMode = currentAuthMode === 'signin' ? 'signup' : 'signin';
  updateAuthModalUI();
}

// Update the Email Auth Modal UI text based on the active mode
function updateAuthModalUI() {
  const authModalTitle = document.getElementById('authModalTitle');
  const btnSubmitAuth = document.getElementById('btnSubmitAuth');
  const authToggleText = document.getElementById('authToggleText');
  const btnToggleAuthMode = document.getElementById('btnToggleAuthMode');
  
  if (currentAuthMode === 'signin') {
    if (authModalTitle) authModalTitle.textContent = 'Sign in to MomentAI';
    if (btnSubmitAuth) btnSubmitAuth.textContent = 'Sign In';
    if (authToggleText) authToggleText.textContent = "Don't have an account?";
    if (btnToggleAuthMode) btnToggleAuthMode.textContent = 'Sign Up';
  } else {
    if (authModalTitle) authModalTitle.textContent = 'Create MomentAI Account';
    if (btnSubmitAuth) btnSubmitAuth.textContent = 'Sign Up';
    if (authToggleText) authToggleText.textContent = 'Already have an account?';
    if (btnToggleAuthMode) btnToggleAuthMode.textContent = 'Sign In';
  }
}

// Handle Email / Password authentication form submission
async function handleAuthSubmit(e) {
  e.preventDefault();
  
  const emailInput = document.getElementById('authEmail');
  const passwordInput = document.getElementById('authPassword');
  const btnSubmitAuth = document.getElementById('btnSubmitAuth');
  
  if (!emailInput || !passwordInput) return;
  if (!supabase) {
    alert('Authentication service is not fully configured on the server. Please ensure SUPABASE_URL and SUPABASE_ANON_KEY are set in your DigitalOcean App Platform environment variables.');
    return;
  }
  
  const email = emailInput.value.trim();
  const password = passwordInput.value;
  
  setButtonLoading(btnSubmitAuth, true);
  
  try {
    let result;
    if (currentAuthMode === 'signin') {
      result = await supabase.auth.signInWithPassword({ email, password });
    } else {
      result = await supabase.auth.signUp({ email, password });
    }
    
    if (result.error) {
      throw result.error;
    }
    
    // Close modal on success
    await toggleModal(signInGateModal, false);
    
    // Clear fields
    emailInput.value = '';
    passwordInput.value = '';
    
    if (currentAuthMode === 'signup') {
      alert('Account created successfully! You are now signed in.');
    }
  } catch (error) {
    console.error('Authentication failed:', error);
    alert(error.message || 'Authentication failed. Please check your credentials.');
  } finally {
    setButtonLoading(btnSubmitAuth, false);
  }
}

// Legacy checkAuth function - now delegates to initSupabaseAuth
async function checkAuth() {
  if (!supabase) {
    await initSupabaseAuth();
    return;
  }

  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    supabaseAccessToken = null;
    authState.loggedIn = false;
    authState.user = null;
    renderDisconnectedPanel();
    return;
  }

  supabaseAccessToken = session.access_token;
  await syncUserWithBackend();
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
        <button class="btn-text" id="btnLogout">Sign out</button>
      </div>
    </div>
    ${user.tier === 'free' ? '<button class="btn btn-secondary" id="btnShowBilling">Upgrade</button>' : '<button class="btn btn-secondary" id="btnManageBilling">Manage subscription</button>'}
  `;

  // Attach logout event
  document.getElementById('btnLogout').addEventListener('click', logout);
  
  const showBilling = document.getElementById('btnShowBilling');
  if (showBilling) {
    showBilling.addEventListener('click', () => toggleModal(tokenModal, true));
  }

  const manageBilling = document.getElementById('btnManageBilling');
  if (manageBilling) {
    manageBilling.addEventListener('click', openBillingPortal);
  }
  
  updatePlaylistBlurState();
}

function renderDisconnectedPanel() {
  userPanel.innerHTML = `
    <button class="btn btn-primary" id="btnSignIn" type="button" style="border-radius:20px">Sign in</button>
  `;
  document.getElementById('btnSignIn').addEventListener('click', () => openAuthModal('signin'));
  
  updatePlaylistBlurState();
}

// Update Playlist Blur State helper
function updatePlaylistBlurState() {
  const trackCards = document.querySelectorAll('#tracklistContainer .track-card');
  const VISIBLE_TRACKS = 3;
  
  trackCards.forEach((card, index) => {
    if (!authState.loggedIn && index >= VISIBLE_TRACKS) {
      card.classList.add('track-blurred');
    } else {
      card.classList.remove('track-blurred');
    }
  });

  // Remove existing banner if any
  const existingBanner = document.getElementById('blurSignInBanner');
  if (existingBanner) {
    existingBanner.remove();
  }

  // If anonymous and has blurred tracks, append the Sign In banner
  if (!authState.loggedIn && trackCards.length > VISIBLE_TRACKS) {
    const banner = document.createElement('div');
    banner.id = 'blurSignInBanner';
    banner.className = 'blur-signin-banner';
    banner.innerHTML = `
      <div class="blur-banner-content">
        <span class="blur-banner-icon">🔒</span>
        <p>Sign in to see all ${trackCards.length} tracks and save your playlist</p>
        <button class="btn btn-primary btn-sm" id="btnBlurSignIn" type="button" style="border-radius:20px">
          Sign in
        </button>
      </div>
    `;
    tracklistContainer.appendChild(banner);
    document.getElementById('btnBlurSignIn').addEventListener('click', () => openAuthModal('signin'));
  }
}

// Logout
async function logout() {
  try {
    if (supabase) {
      await supabase.auth.signOut();
    }
    await apiFetch('/api/auth/logout', { method: 'POST' });
    supabaseAccessToken = null;
    authState.loggedIn = false;
    authState.user = null;
    renderDisconnectedPanel();
    hidePreviewCtas();
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
  if (!authState.loggedIn) {
    openAuthModal('signup');
    return;
  }
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
async function resetUploader() {
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

  const grid = document.querySelector('.dashboard-grid');
  await transitionToLanding({
    grid,
    landingStack,
    analysisCard,
    analysisLoader
  });

  setButtonLoading(btnGeneratePlaylist, false);
  
  // Reset tracklist
  tracklistContainer.innerHTML = `
    <div class="tracklist-placeholder">
      <div class="placeholder-icon"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="svg-icon"><path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle></svg></div>
      <p>Your recommendations will appear here</p>
    </div>
  `;
  playlistStatusText.textContent = "Upload an image to generate recommended tracks";
  hidePreviewCtas();
  
  if (spotifyPlayerContainer) {
    hidePanel(spotifyPlayerContainer);
    spotifyPlayerContainer.innerHTML = '';
  }
  activeTrack = null;

  currentGeneration = {
    id: null,
    imagePath: null,
    metadata: null,
    tracks: [],
    suggestedTracks: [],
    customPrompt: ''
  };

  if (suggestionsPanel) suggestionsPanel.classList.add('hidden');
  if (suggestionsList) suggestionsList.innerHTML = '';
  if (btnLoadMoreSuggestions) btnLoadMoreSuggestions.classList.add('hidden');
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
    currentGeneration.suggestedTracks = result.suggestedTracks || [];

    const grid = document.querySelector('.dashboard-grid');
    await transitionToPreview({
      grid,
      landingStack,
      analysisCard,
      analysisLoader,
      showLoader: false
    });

    if (importCard) {
      importCard.classList.add('hidden');
    }
    updateChromeState(true);

    if (result.coverUrl) {
      sourceImagePreview.src = result.coverUrl;
    } else {
      sourceImagePreview.src = 'https://via.placeholder.com/300?text=Imported+Playlist';
    }

    // Render results
    renderAnalysisResults(result.metadata);
    refreshPlaylistEditor();

    // Show save option if user is logged in
    if (authState.loggedIn) {
      showPreviewCtas();
      btnSavePlaylist.textContent = "Clone Playlist to Spotify";
      btnSavePlaylist.disabled = false;
    } else {
      playlistStatusText.textContent = "Sign in to save this playlist to Spotify";
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
        await toggleModal(tokenModal, true);
      }
      throw new Error(errData.message || "Failed to process image.");
    }

    const result = await res.json();
    currentGeneration.id = result.generationId;
    currentGeneration.imagePath = result.imagePath;
    currentGeneration.metadata = result.metadata;
    currentGeneration.tracks = result.tracks;
    currentGeneration.suggestedTracks = result.suggestedTracks || [];
    currentGeneration.customPrompt = customPromptInput?.value.trim() || '';

    // Refresh user tokens if logged in
    if (authState.loggedIn) {
      checkAuth();
    }

    // Render results
    renderAnalysisResults(result.metadata);
    refreshPlaylistEditor();

    // Always show Save to Spotify
    showPreviewCtas();
    btnSavePlaylist.textContent = "Save Playlist to Spotify";
    btnSavePlaylist.disabled = false;

    if (!authState.loggedIn) {
      playlistStatusText.textContent = "Sign in to see all tracks and save to Spotify";
    }

  } catch (error) {
    console.error("Pipeline failure:", error);
    alert(error.message);
    await resetUploader();
  } finally {
    analysisLoader.classList.add('hidden');
    setButtonLoading(btnGeneratePlaylist, false);
  }
}

// Render Gemini visual metadata outputs
function renderAnalysisResults(metadata) {
  const vibeLabel = metadata.emotionalVibe
    ? metadata.emotionalVibe.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
    : 'Visual Vibe';

  if (aestheticTitle) {
    aestheticTitle.textContent = `Aesthetic: ${vibeLabel}`;
  }
  if (metricEnergy) {
    metricEnergy.textContent = `⚡ ${Math.round(metadata.energy * 100)}% Neon Energy`;
  }
  if (metricMood) {
    metricMood.textContent = `🌙 ${Math.round((1 - metadata.valence) * 100)}% Midnight Mood`;
  }
  if (genresLabel) {
    genresLabel.textContent = `Genres: ${metadata.seedGenres.join(', ')}`;
  }

  if (colorSwatches) {
    colorSwatches.innerHTML = '';
    metadata.dominantColorPalette.slice(0, 4).forEach((color, i) => {
      const swatch = document.createElement('span');
      swatch.className = 'color-swatch';
      swatch.style.backgroundColor = getTagColorHex(color);
      swatch.style.setProperty('--stagger-delay', `${i * 60}ms`);
      colorSwatches.appendChild(swatch);
    });
  }

  colorTags.innerHTML = '';
  metadata.dominantColorPalette.forEach(color => {
    const tag = document.createElement('span');
    tag.className = 'tag color-tag stagger-enter';
    tag.style.borderLeftColor = getTagColorHex(color);
    tag.textContent = color;
    colorTags.appendChild(tag);
  });

  envContext.textContent = metadata.environmentalContext;
  emotionalVibe.textContent = metadata.emotionalVibe;

  valValence.textContent = metadata.valence.toFixed(2);
  barValence.style.width = '0%';
  valEnergy.textContent = metadata.energy.toFixed(2);
  barEnergy.style.width = '0%';
  valAcousticness.textContent = metadata.acousticness.toFixed(2);
  barAcousticness.style.width = '0%';

  requestAnimationFrame(() => {
    barValence.style.width = `${metadata.valence * 100}%`;
    barEnergy.style.width = `${metadata.energy * 100}%`;
    barAcousticness.style.width = `${metadata.acousticness * 100}%`;
  });

  genreTags.innerHTML = '';
  metadata.seedGenres.forEach(genre => {
    const tag = document.createElement('span');
    tag.className = 'tag genre-tag stagger-enter';
    tag.textContent = genre;
    genreTags.appendChild(tag);
  });

  if (aestheticTitle) {
    aestheticTitle.classList.add('stagger-enter');
    requestAnimationFrame(() => aestheticTitle.classList.add('stagger-visible'));
  }
  staggerIn(document.querySelector('.metric-row'), '.metric-pill', 50);
}

// Helper to determine border accent based on color string
function getTagColorHex(colorName) {
  const cn = colorName.toLowerCase();
  if (cn.includes('blue') || cn.includes('neon') || cn.includes('electric')) return '#4361ee';
  if (cn.includes('purple') || cn.includes('cyber') || cn.includes('magenta')) return '#7209b7';
  if (cn.includes('pink') || cn.includes('pastel') || cn.includes('glow')) return '#f72585';
  if (cn.includes('cyan') || cn.includes('turquoise') || cn.includes('ocean')) return '#4cc9f0';
  if (cn.includes('gold') || cn.includes('yellow') || cn.includes('warm') || cn.includes('sunny')) return '#fbc02d';
  if (cn.includes('green') || cn.includes('nature')) return '#1db954';
  if (cn.includes('red') || cn.includes('vintage')) return '#ff4b4b';
  if (cn.includes('monochrome') || cn.includes('dark') || cn.includes('black')) return '#8e8e9f';
  return '#4361ee';
}

function getTrackCoverUrl(track) {
  const images = track.album?.images;
  if (!images?.length) return null;
  return images[images.length - 1]?.url || images[0]?.url || null;
}

function buildTrackCoverMarkup(track) {
  const coverUrl = getTrackCoverUrl(track);
  if (!coverUrl) {
    return '<div class="track-cover track-cover--fallback" aria-hidden="true"></div>';
  }

  return `<img class="track-cover" src="${escapeHtml(coverUrl)}" alt="" loading="lazy" onerror="this.onerror=null;this.replaceWith(Object.assign(document.createElement('div'),{className:'track-cover track-cover--fallback'}))">`;
}

function buildTrackCardMarkup(track, index, mode) {
  const artists = track.artists.map((artist) => artist.name).join(', ');
  const duration = formatDuration(track.duration_ms);
  const actionButton = mode === 'playlist'
    ? `<button type="button" class="btn-track-action btn-remove-track" data-track-id="${escapeHtml(track.id)}" title="Remove from playlist" aria-label="Remove ${escapeHtml(track.name)} from playlist">×</button>`
    : `<button type="button" class="btn-track-action btn-add-track" data-track-id="${escapeHtml(track.id)}" title="Add to playlist" aria-label="Add ${escapeHtml(track.name)} to playlist">+</button>`;

  return `
    <div class="track-card stagger-enter" id="track-${track.id}" data-track-id="${escapeHtml(track.id)}">
      <div class="track-main-info">
        <span class="track-index">${index + 1}</span>
        ${buildTrackCoverMarkup(track)}
        <div class="track-text">
          <h4 class="track-title">${escapeHtml(track.name)}</h4>
          <p class="track-artist">${escapeHtml(artists)}</p>
        </div>
        <span class="track-album">${escapeHtml(track.album.name)}</span>
      </div>
      <div class="track-controls">
        <span class="track-duration">${duration}</span>
        <button type="button" class="btn-play-preview" data-track-id="${escapeHtml(track.id)}" title="Play on Spotify">▶</button>
        ${actionButton}
      </div>
    </div>
  `;
}

function getExcludedTrackIds() {
  return [
    ...currentGeneration.tracks,
    ...currentGeneration.suggestedTracks
  ].map((track) => track.id);
}

function updatePlaylistStatusText() {
  const playlistCount = currentGeneration.tracks.length;
  const suggestionCount = currentGeneration.suggestedTracks.length;

  if (playlistCount === 0) {
    playlistStatusText.textContent = suggestionCount > 0
      ? 'Add songs from the suggestions below'
      : 'Try uploading a different image.';
    return;
  }

  playlistStatusText.textContent = `${playlistCount} track${playlistCount === 1 ? '' : 's'} in your playlist`;
}

function refreshPlaylistEditor() {
  renderPlaylistTracks(currentGeneration.tracks);
  renderSuggestedTracks(currentGeneration.suggestedTracks);
  updatePlaylistStatusText();

  if (btnSavePlaylist) {
    btnSavePlaylist.disabled = currentGeneration.tracks.length === 0;
  }

  if (btnLoadMoreSuggestions) {
    btnLoadMoreSuggestions.classList.toggle('hidden', !currentGeneration.metadata);
  }
}

function renderPlaylistTracks(tracks) {
  tracklistContainer.innerHTML = '';

  if (tracks.length === 0) {
    tracklistContainer.innerHTML = `
      <div class="tracklist-placeholder tracklist-placeholder--compact">
        <p>No songs in your playlist yet. Add tracks from the suggestions below.</p>
      </div>
    `;
    showPreviewCtas();
    updateChromeState(true);
    return;
  }

  tracks.forEach((track, index) => {
    tracklistContainer.insertAdjacentHTML('beforeend', buildTrackCardMarkup(track, index, 'playlist'));
  });

  updatePlaylistBlurState();

  staggerIn(tracklistContainer, '.track-card', 40);
  showPreviewCtas();
  updateChromeState(true);
}

function renderSuggestedTracks(tracks) {
  if (!suggestionsPanel || !suggestionsList) return;

  if (!currentGeneration.metadata) {
    suggestionsPanel.classList.add('hidden');
    suggestionsList.innerHTML = '';
    return;
  }

  suggestionsPanel.classList.remove('hidden');
  suggestionsList.innerHTML = '';

  if (tracks.length === 0) {
    suggestionsList.innerHTML = `
      <p class="suggestions-empty">No extra recommendations right now. Load more to discover similar tracks.</p>
    `;
    return;
  }

  tracks.forEach((track, index) => {
    suggestionsList.insertAdjacentHTML('beforeend', buildTrackCardMarkup(track, index, 'suggestion'));
  });

  staggerIn(suggestionsList, '.track-card', 40);
}

function handlePlaylistTrackClick(event) {
  const removeButton = event.target.closest('.btn-remove-track');
  if (removeButton) {
    event.stopPropagation();
    removeTrackFromPlaylist(removeButton.dataset.trackId);
    return;
  }

  const playButton = event.target.closest('.btn-play-preview');
  const mainInfo = event.target.closest('.track-main-info');
  if (playButton || mainInfo) {
    const card = event.target.closest('.track-card');
    if (card?.dataset.trackId) {
      togglePlayTrack(card.dataset.trackId);
    }
  }
}

function handleSuggestionTrackClick(event) {
  const addButton = event.target.closest('.btn-add-track');
  if (addButton) {
    event.stopPropagation();
    addTrackToPlaylist(addButton.dataset.trackId);
    return;
  }

  const playButton = event.target.closest('.btn-play-preview');
  const mainInfo = event.target.closest('.track-main-info');
  if (playButton || mainInfo) {
    const card = event.target.closest('.track-card');
    if (card?.dataset.trackId) {
      togglePlayTrack(card.dataset.trackId, true);
    }
  }
}

function removeTrackFromPlaylist(trackId) {
  const trackIndex = currentGeneration.tracks.findIndex((track) => track.id === trackId);
  if (trackIndex === -1) return;

  const [removedTrack] = currentGeneration.tracks.splice(trackIndex, 1);

  if (activeTrack === trackId) {
    if (currentAudio) {
      currentAudio.pause();
      currentAudio = null;
    }
    activeTrack = null;
    hidePanel(spotifyPlayerContainer);
    spotifyPlayerContainer.innerHTML = '';
  }

  if (!currentGeneration.suggestedTracks.some((track) => track.id === removedTrack.id)) {
    currentGeneration.suggestedTracks.unshift(removedTrack);
  }

  refreshPlaylistEditor();
}

function addTrackToPlaylist(trackId) {
  if (currentGeneration.tracks.some((track) => track.id === trackId)) return;

  const suggestionIndex = currentGeneration.suggestedTracks.findIndex((track) => track.id === trackId);
  if (suggestionIndex === -1) return;

  const [track] = currentGeneration.suggestedTracks.splice(suggestionIndex, 1);
  currentGeneration.tracks.push(track);
  refreshPlaylistEditor();
}

async function loadMoreSuggestions() {
  if (!currentGeneration.metadata || !btnLoadMoreSuggestions) return;

  setButtonLoading(btnLoadMoreSuggestions, true, true);

  try {
    const res = await apiFetch('/api/playlist/suggest-more', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        metadata: currentGeneration.metadata,
        excludeTrackIds: getExcludedTrackIds(),
        customPrompt: currentGeneration.customPrompt
      })
    });

    if (!res.ok) {
      const errData = await res.json();
      throw new Error(errData.message || 'Failed to load more suggestions.');
    }

    const result = await res.json();
    const incoming = result.tracks || [];
    const existingIds = new Set(getExcludedTrackIds());

    incoming.forEach((track) => {
      if (track?.id && !existingIds.has(track.id)) {
        currentGeneration.suggestedTracks.push(track);
        existingIds.add(track.id);
      }
    });

    refreshPlaylistEditor();
  } catch (error) {
    console.error('Failed to load more suggestions:', error);
    alert(error.message);
  } finally {
    setButtonLoading(btnLoadMoreSuggestions, false);
  }
}

// Render Track recommendations list (legacy entry point)
function renderTracks(tracks) {
  currentGeneration.tracks = tracks || [];
  refreshPlaylistEditor();
}

// Toggle Play track via Spotify Embed / Native Audio
window.togglePlayTrack = function(trackId, searchSuggestions = false) {
  const trackLists = searchSuggestions
    ? [currentGeneration.suggestedTracks, currentGeneration.tracks]
    : [currentGeneration.tracks, currentGeneration.suggestedTracks];
  const track = trackLists[0].find((item) => item.id === trackId)
    || trackLists[1].find((item) => item.id === trackId);
  if (!track) return;

  const card = document.getElementById(`track-${trackId}`);

  // Pause and reset existing audio instance if playing
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }

  if (activeTrack === trackId) {
    if (card) card.classList.remove('active');
    hidePanel(spotifyPlayerContainer);
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
    if (card) card.classList.add('active');
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
        hidePanel(spotifyPlayerContainer);
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
    showPanel(spotifyPlayerContainer);
  }
};

// Open Save Playlist Modal
async function savePlaylistToSpotify() {
  if (!currentGeneration.tracks.length) return;

  if (!authState.loggedIn) {
    await toggleModal(signInGateModal, true);
    return;
  }

  const vibeName = currentGeneration.metadata ? currentGeneration.metadata.emotionalVibe : "Visual Vibe";
  const defaultPlaylistName = `${vibeName} - Moment.AI`;
  const defaultDescription = `Visual playlist based on dominant colors: ${currentGeneration.metadata ? currentGeneration.metadata.dominantColorPalette.join(', ') : ''} and vibe: ${vibeName}. Generated by Moment.AI.`;

  // Prefill form
  modalPlaylistName.value = defaultPlaylistName;
  modalPlaylistDescription.value = defaultDescription;
  modalUploadCover.checked = true;

  // Open modal
  await toggleModal(savePlaylistModal, true);
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
  successModalText.textContent = `Playlist "${playlistName}" is live! Open it on Spotify and tap Save (➕) to add it to your library.`;
  linkOpenSpotify.href = url;
  toggleModal(successModal, true);
}

// Confirm Save Playlist to Spotify Account
async function confirmSavePlaylistToSpotify() {
  const playlistName = modalPlaylistName.value.trim();
  const playlistDescription = modalPlaylistDescription.value.trim();
  const isPublic = true;
  const uploadCover = modalUploadCover.checked;

  if (!playlistName) {
    alert("Please enter a playlist name.");
    return;
  }

  // Close Save Modal first
  await toggleModal(savePlaylistModal, false);

  setButtonLoading(btnSavePlaylist, true);
  btnSavePlaylist.dataset.originalText = 'Save Playlist to Spotify';

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
    btnSavePlaylist.classList.remove('is-loading');
    btnSavePlaylist.disabled = false;
    
    showExportSuccessModal(playlistName, data.playlistUrl);

  } catch (error) {
    console.error("Save failed:", error);
    alert(error.message);
    setButtonLoading(btnSavePlaylist, false);
    btnSavePlaylist.textContent = "Save Playlist to Spotify";
  }
}

// Purchase tokens via Stripe Checkout
async function purchaseTokens() {
  btnBuyTokens.disabled = true;
  btnBuyTokens.textContent = 'Redirecting...';

  try {
    const res = await apiFetch('/api/payment/create-checkout-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ purchaseType: 'token_pack' })
    });
    const data = await res.json();

    if (res.ok && data.url) {
      window.location.href = data.url;
      return;
    }

    if (res.status === 503) {
      const fallback = await apiFetch('/api/payment/purchase-tokens', { method: 'POST' });
      const fallbackData = await fallback.json();
      if (fallback.ok) {
        alert(fallbackData.message);
        await toggleModal(tokenModal, false);
        checkAuth();
        return;
      }
      throw new Error(fallbackData.message);
    }

    throw new Error(data.message || 'Unable to start checkout.');
  } catch (error) {
    alert(error.message);
  } finally {
    btnBuyTokens.disabled = false;
    btnBuyTokens.textContent = 'Purchase Pack';
  }
}

// Upgrade to Premium via Stripe Checkout
async function upgradePremium() {
  btnBuyPremium.disabled = true;
  btnBuyPremium.textContent = 'Redirecting...';

  try {
    const res = await apiFetch('/api/payment/create-checkout-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ purchaseType: 'premium' })
    });
    const data = await res.json();

    if (res.ok && data.url) {
      window.location.href = data.url;
      return;
    }

    if (res.status === 503) {
      const fallback = await apiFetch('/api/payment/subscribe', { method: 'POST' });
      const fallbackData = await fallback.json();
      if (fallback.ok) {
        alert(fallbackData.message);
        await toggleModal(tokenModal, false);
        checkAuth();
        return;
      }
      throw new Error(fallbackData.message);
    }

    throw new Error(data.message || 'Unable to start checkout.');
  } catch (error) {
    alert(error.message);
  } finally {
    btnBuyPremium.disabled = false;
    btnBuyPremium.textContent = 'Upgrade to Premium';
  }
}

async function openBillingPortal() {
  try {
    const res = await apiFetch('/api/payment/create-portal-session', { method: 'POST' });
    const data = await res.json();

    if (res.ok && data.url) {
      window.location.href = data.url;
      return;
    }

    throw new Error(data.message || 'Unable to open billing portal.');
  } catch (error) {
    alert(error.message);
  }
}

function handlePaymentReturn() {
  const params = new URLSearchParams(window.location.search);
  const paymentStatus = params.get('payment');

  if (!paymentStatus) return;

  if (paymentStatus === 'success') {
    alert('Payment received! Your account will update in a moment.');
    checkAuth();
  } else if (paymentStatus === 'cancelled') {
    alert('Checkout was cancelled. No charge was made.');
  }

  params.delete('payment');
  params.delete('session_id');
  const nextQuery = params.toString();
  const nextUrl = `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ''}${window.location.hash}`;
  window.history.replaceState({}, document.title, nextUrl);
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

// Deep link listener — simplified for Supabase Auth
function setupDeepLinkListener() {
  if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App) {
    window.Capacitor.Plugins.App.addListener('appUrlOpen', async (event) => {
      console.log('App opened with URL:', event.url);
      
      // Close mobile in-app browser sheet if it is still open
      if (window.Capacitor.Plugins.Browser) {
        await window.Capacitor.Plugins.Browser.close();
      }
      
      // Supabase handles the OAuth callback automatically.
      // We just re-check authentication state.
      await initSupabaseAuth();
    });
  }
}

// Show Vibe Card
