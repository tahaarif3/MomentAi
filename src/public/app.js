// Base API URL configuration
import {
  hidePanel,
  runViewTransition,
  setButtonLoading,
  showPanel,
  staggerIn,
  toggleModal
} from './animations.js';
import { initRouter, registerScreen, showScreen } from './router.js';
import { startCamera, stopCamera, capturePhotoFromVideo, bindCameraLifecycle } from './camera.js';
import {
  fetchHistory,
  renderMomentsGrid,
  updateMomentsCounter,
  startDemoTicker,
  stopDemoTicker
} from './history.js';
import { buildShareCardDom, downloadShareCardPng, copyPlaylistLink } from './share-card.js';

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
let pendingGenerationResult = null;

// DOM Elements
const userPanel = document.getElementById('userPanel');
const btnSignIn = document.getElementById('btnSignIn');
const fileInput = document.getElementById('fileInput');
const viewfinderUpload = document.getElementById('viewfinderUpload');
const sourceImagePreview = document.getElementById('sourceImagePreview');
const analysisLoader = document.getElementById('analysisLoader');
const btnResetImage = document.getElementById('btnResetImage');
const dropZoneContent = document.getElementById('dropZoneContent');
const uploadPreview = document.getElementById('uploadPreview');
const btnGeneratePlaylist = document.getElementById('btnGeneratePlaylist');
const viewfinderVideo = document.getElementById('viewfinderVideo');
const selfieVideo = document.getElementById('selfieVideo');
const btnShutter = document.getElementById('btnShutter');
const btnHomeCapture = document.getElementById('btnHomeCapture');
const btnFloatingShutter = document.getElementById('btnFloatingShutter');
const btnCaptureBack = document.getElementById('btnCaptureBack');
const btnPlaylistBack = document.getElementById('btnPlaylistBack');
const btnShareCard = document.getElementById('btnShareCard');
const btnRegenerate = document.getElementById('btnRegenerate');
const btnNavPlus = document.getElementById('btnNavPlus');
const momentsGrid = document.getElementById('momentsGrid');
const momentsCounter = document.getElementById('momentsCounter');
const momentsCount = document.getElementById('momentsCount');
const demoTicker = document.getElementById('demoTicker');
const playlistCover = document.getElementById('playlistCover');
const playlistMetaLine = document.getElementById('playlistMetaLine');
const playlistEyebrow = document.getElementById('playlistEyebrow');
const loadingPct = document.getElementById('loadingPct');
const btnBuyPremium = document.getElementById('btnBuyPremium');
const btnManageBilling = document.getElementById('btnManageBilling');

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

// Pricing / paywall
const signInGateModal = document.getElementById('signInGateModal');
const btnNewPhoto = document.getElementById('btnNewPhoto');
const aestheticTitle = document.getElementById('aestheticTitle');
const metricEnergy = document.getElementById('metricEnergy');
const metricMood = document.getElementById('metricMood');
const colorSwatches = document.getElementById('colorSwatches');
const genresLabel = document.getElementById('genresLabel');

// Error Modal elements
const errorModal = document.getElementById('errorModal');
const errorTitle = document.getElementById('errorTitle');
const errorMessage = document.getElementById('errorMessage');
const errorIconBadge = document.getElementById('errorIconBadge');
const btnErrorRetry = document.getElementById('btnErrorRetry');
const btnErrorDismiss = document.getElementById('btnErrorDismiss');
const btnErrorClose = document.getElementById('btnErrorClose');
const analysisCard = document.getElementById('analysisCard');

function updateChromeState(_isPreview) {
  /* legacy no-op — v2 uses screen router */
}

function showPreviewCtas() {
  if (btnSavePlaylist) btnSavePlaylist.classList.remove('hidden');
  if (btnNewPhoto) btnNewPhoto.classList.remove('hidden');
}

function hidePreviewCtas() {
  if (btnSavePlaylist) btnSavePlaylist.classList.add('hidden');
  if (btnNewPhoto) btnNewPhoto.classList.add('hidden');
}

function updateHomeEyebrow() {
  const el = document.getElementById('homeEyebrow');
  const headline = document.getElementById('homeHeadline');
  if (!el) return;
  const hour = new Date().getHours();
  let label = 'EVENING';
  if (hour >= 5 && hour < 12) label = 'MORNING';
  else if (hour >= 12 && hour < 17) label = 'AFTERNOON';
  else if (hour >= 17 && hour < 21) label = 'GOLDEN HOUR';
  const minsLeft = 60 - new Date().getMinutes();
  el.textContent = `${label} · ${minsLeft}M LEFT`;
  if (headline) {
    const name = authState.user?.displayName?.split(' ')[0] || '';
    headline.textContent = name ? `Catch the light, ${name}.` : 'Catch the light.';
  }
}

async function refreshHomeScreen() {
  updateHomeEyebrow();
  if (authState.loggedIn) {
    try {
      const data = await fetchHistory(apiFetch);
      renderMomentsGrid(momentsGrid, data.history || [], {
        isLoggedIn: true,
        onOpen: openSavedMoment,
        onSignInNudge: () => openAuthModal('signin')
      });
      if (momentsCount) momentsCount.textContent = `${(data.history || []).length} saved`;
      updateMomentsCounter(momentsCounter, data.remainingToday, authState.user?.tier);
    } catch (err) {
      console.warn('History load failed:', err);
    }
  } else {
    renderMomentsGrid(momentsGrid, [], {
      isLoggedIn: false,
      onOpen: () => {},
      onSignInNudge: () => openAuthModal('signin')
    });
    updateMomentsCounter(momentsCounter, 3, 'free');
  }
  wirePaywallLinks(document.getElementById('screenHome'));
}

function wirePaywallLinks(root = document) {
  root.querySelectorAll('[data-action="paywall"]').forEach((el) => {
    el.onclick = () => showScreen('paywall');
  });
}

async function openSavedMoment(generationId) {
  try {
    const res = await apiFetch(`/api/playlist/generation/${generationId}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Could not open moment.');
    if (!data.tracks?.length && data.playlistUrl) {
      window.open(data.playlistUrl, '_blank');
      return;
    }
    applyGenerationResult(data);
    showScreen('playlist');
  } catch (err) {
    showErrorScreen('Could not open moment', err.message, 'generic');
  }
}

function applyGenerationResult(result) {
  currentGeneration.id = result.generationId;
  currentGeneration.imagePath = result.imagePath;
  currentGeneration.metadata = result.metadata;
  currentGeneration.tracks = result.tracks || [];
  currentGeneration.suggestedTracks = result.suggestedTracks || [];
  const customPromptInput = document.getElementById('customTextPrompt');
  currentGeneration.customPrompt = customPromptInput?.value.trim() || '';
  if (result.playlistUrl) currentGeneration.playlistUrl = result.playlistUrl;
  updatePlaylistChrome(result);
  renderAnalysisResults(result.metadata);
  refreshPlaylistEditor();
  if (btnSavePlaylist) {
    btnSavePlaylist.textContent = 'Save to Spotify';
    btnSavePlaylist.disabled = currentGeneration.tracks.length === 0;
  }
  showPreviewCtas();
  checkAuth();
}

function updatePlaylistChrome(result) {
  const meta = result.metadata;
  if (playlistCover && result.imagePath) {
    playlistCover.style.backgroundImage = `url('${result.imagePath}')`;
  }
  if (sourceImagePreview && result.imagePath) {
    sourceImagePreview.src = result.imagePath;
  }
  if (playlistMetaLine && meta) {
    const energyPct = Math.round((meta.energy || 0) * 100);
    const tempo = meta.acousticness > 0.6 ? '72 bpm' : meta.energy > 0.65 ? '118 bpm' : '92 bpm';
    const vibe = (meta.emotionalVibe || '').split(/[,·]/)[0].trim().toLowerCase() || 'wistful';
    const count = (result.tracks || []).length;
    playlistMetaLine.textContent = `${vibe} · warm · ${tempo} · ${count} tracks`;
  }
  if (playlistEyebrow) {
    playlistEyebrow.textContent = authState.loggedIn ? 'your moment · today' : 'your moment';
  }
}

function setupScreenRouter() {
  registerScreen('home', {
    onEnter: () => {
      refreshHomeScreen();
      stopCamera();
    }
  });

  registerScreen('capture', {
    onEnter: async () => {
      viewfinderVideo?.classList.add('hidden');
      viewfinderUpload?.classList.remove('hidden');
      const ok = await startCamera({
        viewfinderVideo,
        selfieVideo,
        onFallback: () => {
          viewfinderVideo?.classList.add('hidden');
          viewfinderUpload?.classList.remove('hidden');
        }
      });
      if (ok) {
        viewfinderVideo?.classList.remove('hidden');
        viewfinderUpload?.classList.add('hidden');
      }
    },
    onLeave: () => stopCamera()
  });

  registerScreen('loading', {
    onLeave: () => {
      analysisLoader?.classList.add('hidden');
      analysisLoader?.setAttribute('aria-busy', 'false');
    }
  });

  registerScreen('playlist', {
    onEnter: () => {
      if (analysisCard) analysisCard.classList.remove('hidden');
    }
  });

  registerScreen('paywall', {
    onEnter: () => {
      const isPremium = authState.user?.tier === 'premium';
      btnBuyPremium?.classList.toggle('hidden', isPremium);
      btnManageBilling?.classList.toggle('hidden', !isPremium);
    }
  });
}

function setLoadingProgress(pct, message) {
  const loaderProgressText = document.getElementById('loaderProgressText');
  if (loaderProgressText && message) loaderProgressText.textContent = message;
  if (loadingPct) loadingPct.textContent = `${Math.round(pct)}% · matching to spotify`;
  const fill = document.getElementById('curationFill');
  if (fill) fill.style.width = `${pct}%`;
}

async function beginGenerationWithFile(file) {
  stagedFile = file;
  if (uploadPreview) {
    uploadPreview.src = URL.createObjectURL(file);
  }
  if (sourceImagePreview) {
    sourceImagePreview.src = URL.createObjectURL(file);
  }
  if (playlistCover) {
    playlistCover.style.backgroundImage = `url('${URL.createObjectURL(file)}')`;
  }
  showScreen('loading');
  analysisLoader?.classList.remove('hidden');
  analysisLoader?.setAttribute('aria-busy', 'true');
  setLoadingProgress(5, 'Reading the light…');
  await uploadAndProcessImage(file);
}

// Setup event listeners
document.addEventListener('DOMContentLoaded', async () => {
  await initSupabaseAuth();
  setupScreenRouter();
  bindCameraLifecycle();
  setupEventListeners();
  setupDeepLinkListener();
  handlePaymentReturn();
  initRouter('home');
  refreshHomeScreen();
  startDemoTicker(demoTicker);
  updateHomeEyebrow();
});

// Setup event listeners
function setupEventListeners() {
  if (btnSignIn) {
    btnSignIn.addEventListener('click', () => openAuthModal('signin'));
  }

  const openCapture = () => showScreen('capture');
  btnHomeCapture?.addEventListener('click', openCapture);
  btnFloatingShutter?.addEventListener('click', openCapture);
  btnCaptureBack?.addEventListener('click', () => showScreen('home'));
  btnPlaylistBack?.addEventListener('click', () => {
    const customPromptInput = document.getElementById('customTextPrompt');
    if (customPromptInput) customPromptInput.value = '';
    document.querySelectorAll('.mood-chip').forEach((chip) => {
      chip.setAttribute('aria-pressed', 'false');
      chip.classList.remove('is-selected');
    });
    showScreen('home');
  });
  document.getElementById('btnShareBack')?.addEventListener('click', () => showScreen('playlist'));
  document.getElementById('btnPaywallBack')?.addEventListener('click', () => showScreen('home'));
  btnNavPlus?.addEventListener('click', () => showScreen('paywall'));

  if (viewfinderUpload) {
    viewfinderUpload.addEventListener('click', () => fileInput?.click());
    viewfinderUpload.addEventListener('dragover', (e) => { e.preventDefault(); viewfinderUpload.classList.add('dragover'); });
    viewfinderUpload.addEventListener('dragleave', () => viewfinderUpload.classList.remove('dragover'));
    viewfinderUpload.addEventListener('drop', (e) => {
      e.preventDefault();
      viewfinderUpload.classList.remove('dragover');
      if (e.dataTransfer.files.length > 0) processSelectedFile(e.dataTransfer.files[0]);
    });
  }

  fileInput?.addEventListener('change', handleFileSelect);
  document.getElementById('btnUploadInstead')?.addEventListener('click', () => fileInput?.click());

  if (btnNewPhoto) btnNewPhoto.addEventListener('click', () => resetUploader());
  if (btnResetImage) btnResetImage.addEventListener('click', resetUploader);

  document.querySelectorAll('.mood-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      const prompt = document.getElementById('customTextPrompt');
      const value = chip.dataset.chip || chip.textContent.trim();
      const selected = chip.getAttribute('aria-pressed') === 'true';
      chip.setAttribute('aria-pressed', selected ? 'false' : 'true');
      chip.classList.toggle('is-selected', !selected);
      if (!prompt) return;
      prompt.value = selected ? '' : value;
    });
  });

  btnShutter?.addEventListener('click', async () => {
    try {
      if (stagedFile) {
        await beginGenerationWithFile(stagedFile);
        return;
      }
      if (viewfinderVideo && !viewfinderVideo.classList.contains('hidden')) {
        const file = await capturePhotoFromVideo(viewfinderVideo);
        await beginGenerationWithFile(file);
        return;
      }
      fileInput?.click();
    } catch (err) {
      showErrorScreen('Capture failed', err.message, 'generic');
    }
  });

  if (btnGeneratePlaylist) {
    btnGeneratePlaylist.addEventListener('click', async () => {
      if (stagedFile) {
        setButtonLoading(btnGeneratePlaylist, true);
        await beginGenerationWithFile(stagedFile);
      }
    });
  }

  btnSavePlaylist?.addEventListener('click', savePlaylistToSpotify);
  btnShareCard?.addEventListener('click', () => showShareScreen());
  btnRegenerate?.addEventListener('click', handleRegenerate);

  if (tracklistContainer) tracklistContainer.addEventListener('click', handlePlaylistTrackClick);
  if (suggestionsList) suggestionsList.addEventListener('click', handleSuggestionTrackClick);
  if (btnLoadMoreSuggestions) btnLoadMoreSuggestions.addEventListener('click', loadMoreSuggestions);

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

  btnBuyPremium?.addEventListener('click', upgradePremium);
  btnManageBilling?.addEventListener('click', openBillingPortal);
  document.getElementById('btnDownloadShare')?.addEventListener('click', handleDownloadShare);
  document.getElementById('btnCopyShareLink')?.addEventListener('click', handleCopyShareLink);
  document.getElementById('btnInstagramStory')?.addEventListener('click', handleInstagramStory);

  // Friendly Error Modal Event Listeners
  let activeRetryCallback = null;

  window.showErrorScreen = function(title, msg, type = 'generic', retryCallback = null) {
    errorTitle.textContent = title;
    errorMessage.textContent = msg;

    if (type === 'rate-limit') {
      errorIconBadge.textContent = '⏳';
      errorIconBadge.style.background = 'linear-gradient(135deg, #f39c12, #d35400)';
      errorIconBadge.style.boxShadow = '0 8px 24px rgba(243, 156, 18, 0.4)';
    } else if (type === 'auth') {
      errorIconBadge.textContent = '🔑';
      errorIconBadge.style.background = 'linear-gradient(135deg, #3498db, #2980b9)';
      errorIconBadge.style.boxShadow = '0 8px 24px rgba(52, 152, 219, 0.4)';
    } else if (type === 'network') {
      errorIconBadge.textContent = '📡';
      errorIconBadge.style.background = 'linear-gradient(135deg, #7f8c8d, #2c3e50)';
      errorIconBadge.style.boxShadow = '0 8px 24px rgba(127, 140, 141, 0.4)';
    } else if (type === 'tokens') {
      errorIconBadge.textContent = '🎟️';
      errorIconBadge.style.background = 'linear-gradient(135deg, #9b59b6, #8e44ad)';
      errorIconBadge.style.boxShadow = '0 8px 24px rgba(155, 89, 182, 0.4)';
    } else {
      errorIconBadge.textContent = '⚠️';
      errorIconBadge.style.background = 'linear-gradient(135deg, #e63946, #d62828)';
      errorIconBadge.style.boxShadow = '0 8px 24px rgba(230, 57, 70, 0.4)';
    }

    if (retryCallback) {
      btnErrorRetry.classList.remove('hidden');
      activeRetryCallback = retryCallback;
    } else {
      btnErrorRetry.classList.add('hidden');
      activeRetryCallback = null;
    }

    toggleModal(errorModal, true);
  };

  if (btnErrorDismiss) btnErrorDismiss.addEventListener('click', () => toggleModal(errorModal, false));
  if (btnErrorClose) btnErrorClose.addEventListener('click', () => toggleModal(errorModal, false));
  if (btnErrorRetry) {
    btnErrorRetry.addEventListener('click', () => {
      toggleModal(errorModal, false);
      if (activeRetryCallback) {
        activeRetryCallback();
      }
    });
  }
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
          if (pendingGenerationResult) {
            console.log("Logged in! Loading pending playlist...");
            toggleModal(signInGateModal, false);
            handleProcessingSuccess(pendingGenerationResult);
            pendingGenerationResult = null;
          }
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
    badgeHtml = '<span class="premium-badge">PLUS</span>';
  } else {
    const left = user.momentsRemainingToday ?? 3;
    badgeHtml = `<span class="token-badge">${left}/3 today</span>`;
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
    showBilling.addEventListener('click', () => showScreen('paywall'));
  }

  const manageBilling = document.getElementById('btnManageBilling');
  if (manageBilling) {
    manageBilling.addEventListener('click', openBillingPortal);
  }
  
  updatePlaylistBlurState();
  refreshHomeScreen();
}

function renderDisconnectedPanel() {
  userPanel.innerHTML = `
    <button class="btn btn-nav-spotify" id="btnSignIn" type="button">Connect Spotify</button>
  `;
  document.getElementById('btnSignIn').addEventListener('click', () => openAuthModal('signin'));
  
  updatePlaylistBlurState();
  refreshHomeScreen();
}

// Update Playlist Blur State helper
function updatePlaylistBlurState() {
  const trackCards = document.querySelectorAll('#tracklistContainer .track-card');
  
  trackCards.forEach((card, index) => {
    if (!authState.loggedIn) {
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

  // If anonymous and has tracks, append the Sign In banner
  if (!authState.loggedIn && trackCards.length > 0) {
    const banner = document.createElement('div');
    banner.id = 'blurSignInBanner';
    banner.className = 'blur-signin-banner';
    banner.innerHTML = `
      <div class="blur-banner-content">
        <p>Sign in to unlock your playlist and save it to Spotify.</p>
        <button class="btn btn-primary btn-sm" id="btnBlurSignIn" type="button">
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
  const validTypes = ['image/jpeg', 'image/png', 'image/webp'];
  if (!validTypes.includes(file.type)) {
    showErrorScreen('Invalid File Format', 'Please upload a JPEG, PNG or WebP image.', 'generic');
    return;
  }
  stagedFile = file;
  const url = URL.createObjectURL(file);
  if (uploadPreview) {
    uploadPreview.src = url;
    uploadPreview.classList.remove('hidden');
  }
  if (dropZoneContent) dropZoneContent.classList.add('hidden');
  btnGeneratePlaylist?.classList.remove('hidden');
  btnShutter?.classList.add('hidden');
}

// Reset Image Upload
async function resetUploader() {
  fileInput.value = '';
  stagedFile = null;
  if (sourceImagePreview) sourceImagePreview.src = '';
  if (currentAudio) { currentAudio.pause(); currentAudio = null; }
  activeTrack = null;
  if (spotifyPlayerContainer) spotifyPlayerContainer.innerHTML = '';
  if (uploadPreview) { uploadPreview.src = ''; uploadPreview.classList.add('hidden'); }
  if (dropZoneContent) dropZoneContent.classList.remove('hidden');
  btnGeneratePlaylist?.classList.add('hidden');
  btnShutter?.classList.remove('hidden');
  const customPromptInput = document.getElementById('customTextPrompt');
  if (customPromptInput) customPromptInput.value = '';
  setButtonLoading(btnGeneratePlaylist, false);
  tracklistContainer.innerHTML = `<div class="tracklist-placeholder"><p>Your tracks will appear here after generation.</p></div>`;
  playlistStatusText.textContent = 'Upload a moment to generate tracks.';
  hidePreviewCtas();
  if (spotifyPlayerContainer) { hidePanel(spotifyPlayerContainer); spotifyPlayerContainer.innerHTML = ''; }
  currentGeneration = { id: null, imagePath: null, metadata: null, tracks: [], suggestedTracks: [], customPrompt: '' };
  if (suggestionsPanel) suggestionsPanel.classList.add('hidden');
  if (suggestionsList) suggestionsList.innerHTML = '';
  if (btnLoadMoreSuggestions) btnLoadMoreSuggestions.classList.add('hidden');
  showScreen('home');
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

    applyGenerationResult({
      generationId: null,
      imagePath: result.coverUrl || null,
      metadata: result.metadata,
      tracks: result.tracks,
      suggestedTracks: result.suggestedTracks || []
    });
    showScreen('playlist');

  } catch (error) {
    console.error("Import failure:", error);
    showErrorScreen("Import Failed", error.message, 'generic', () => importPlaylistFromUrl());
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

  const loaderProgressText = document.getElementById('loaderProgressText');
  if (loaderProgressText) {
    loaderProgressText.textContent = "Uploading image...";
  }

  try {
    const res = await apiFetch('/api/playlist/process', {
      method: 'POST',
      body: formData
    });

    if (!res.ok) {
      const errData = await res.json();
      if (res.status === 403 && errData.code === 'DAILY_LIMIT') {
        showScreen('paywall');
        throw new Error('Daily moment limit reached.');
      }
      throw new Error(errData.message || 'Failed to start image processing.');
    }

    const data = await res.json();

    if (data.jobId) {
      console.log(`Job queued successfully with ID: ${data.jobId}`);
      await connectToJobStream(data.jobId, file);
    } else {
      console.log("Direct processing result returned.");
      handleProcessingSuccess(data);
    }

  } catch (error) {
    console.error('Pipeline failure:', error);
    if (error.message !== 'Daily moment limit reached.') {
      showErrorScreen('Generation Failed', error.message, 'generic', () => uploadAndProcessImage(file));
    }
    showScreen('capture');
  } finally {
    analysisLoader?.classList.add('hidden');
    setButtonLoading(btnGeneratePlaylist, false);
  }
}

function handleProcessingSuccess(result) {
  // Enforce signup/signin gate on generation completion if not logged in
  if (!authState.loggedIn) {
    pendingGenerationResult = result;
    
    // Set customized auth gate messages
    const authModalTitle = document.getElementById('authModalTitle');
    if (authModalTitle) {
      authModalTitle.textContent = "Sign in to see your playlist";
    }
    const gateSubtitle = document.querySelector('#signInGateModal .modal-subtitle');
    if (gateSubtitle) {
      gateSubtitle.textContent = "Your custom playlist is ready! Sign in to reveal the tracks and save it.";
    }

    // Render results behind the modal (fully blurred)
    currentGeneration.id = result.generationId;
    currentGeneration.imagePath = result.imagePath;
    currentGeneration.metadata = result.metadata;
    currentGeneration.tracks = result.tracks;
    currentGeneration.suggestedTracks = result.suggestedTracks || [];

    renderAnalysisResults(result.metadata);
    refreshPlaylistEditor();

    // Trigger the sign in gate modal
    toggleModal(signInGateModal, true);
    showScreen('playlist');
    return;
  }

  applyGenerationResult(result);
  showScreen('playlist');
}

function connectToJobStream(jobId, file) {
  return new Promise((resolve, reject) => {
    const loaderProgressText = document.getElementById('loaderProgressText');
    const streamUrl = `/api/playlist/job/${jobId}/stream`;
    const eventSource = new EventSource(streamUrl);
    let settled = false;

    const finishOk = (result) => {
      if (settled) return;
      settled = true;
      eventSource.close();
      setLoadingProgress(100, 'Curating tracks…');
      handleProcessingSuccess(result);
      resolve();
    };

    const finishErr = (userMsg, type = 'generic', title = 'Generation Failed') => {
      if (settled) return;
      settled = true;
      eventSource.close();
      showErrorScreen(title, userMsg, type, () => uploadAndProcessImage(file));
      reject(new Error(userMsg));
    };

    const recoverFromStatus = async () => {
      try {
        const res = await apiFetch(`/api/playlist/job/${jobId}`);
        if (!res.ok) return false;
        const data = await res.json();
        if (data.state === 'completed' && data.result) {
          finishOk(data.result);
          return true;
        }
        if (data.state === 'failed' && (data.attemptsMade || 0) >= (data.attempts || 4)) {
          finishErr(data.message || 'Generation failed.');
          return true;
        }
        if (loaderProgressText) loaderProgressText.textContent = 'Still working — reconnecting…';
        return false;
      } catch (err) {
        console.warn('[Job Status Recovery] Failed:', err);
        return false;
      }
    };

    eventSource.addEventListener('retrying', (e) => {
      try {
        const data = JSON.parse(e.data);
        setLoadingProgress(35, data.message || 'AI is busy — retrying…');
      } catch (err) {
        console.error('Failed to parse retry data:', err);
      }
    });

    eventSource.addEventListener('progress', (e) => {
      try {
        const progress = JSON.parse(e.data);
        const stage = progress.stage;
        let pct = 45;
        let msg = progress.message || 'Reading the light…';
        if (stage === 'analyzing') {
          pct = 12 + Math.random() * 23;
          msg = 'Reading the light…';
        } else if (stage === 'resolving') {
          const match = msg.match(/(\d+)\s*\/\s*(\d+)/);
          if (match) {
            pct = 40 + Math.round((Number(match[1]) / Number(match[2])) * 45);
          } else {
            pct = 55;
          }
          msg = 'Matching the mood…';
        } else if (stage === 'finalizing') {
          pct = 90;
          msg = 'Curating tracks…';
        }
        setLoadingProgress(Math.min(pct, 95), msg);
      } catch (err) {
        console.error('Failed to parse progress data:', err);
      }
    });

    eventSource.addEventListener('completed', (e) => {
      try {
        finishOk(JSON.parse(e.data));
      } catch (err) {
        finishErr('Failed to read completed playlist data.');
      }
    });

    eventSource.addEventListener('failed', (e) => {
      try {
        const errData = JSON.parse(e.data);
        let type = 'generic';
        let errorTitle = 'Generation Failed';
        let userMsg = errData.message || 'An error occurred during playlist generation.';
        if (userMsg.includes('overloaded') || userMsg.includes('rate limit')) {
          type = 'rate-limit';
          errorTitle = 'High Demand';
          userMsg = 'The music recommendation engine is temporarily overloaded. Please try again in a few seconds.';
        }
        finishErr(userMsg, type, errorTitle);
      } catch (err) {
        finishErr('Job failed with an unknown error.');
      }
    });

    let errorRetries = 0;
    eventSource.onerror = async () => {
      if (settled) return;
      errorRetries += 1;
      const recovered = await recoverFromStatus();
      if (recovered) return;
      if (errorRetries >= 3) {
        eventSource.close();
        const ok = await recoverFromStatus();
        if (!ok) finishErr('Loss of connection to generation server. Please try again.');
      }
    };
  });
}

async function handleRegenerate() {
  if (authState.user?.tier !== 'premium') {
    showScreen('paywall');
    return;
  }
  if (!currentGeneration.id) {
    showErrorScreen('Regenerate unavailable', 'Save this moment first while signed in.', 'generic');
    return;
  }
  showScreen('loading');
  analysisLoader?.classList.remove('hidden');
  setLoadingProgress(5, 'Reading the light…');
  try {
    const res = await apiFetch('/api/playlist/regenerate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ generationId: currentGeneration.id })
    });
    const data = await res.json();
    if (!res.ok) {
      if (data.code === 'PLUS_REQUIRED') {
        showScreen('paywall');
        return;
      }
      throw new Error(data.message || 'Regenerate failed.');
    }
    if (data.jobId) {
      await connectToJobStream(data.jobId, stagedFile);
    } else {
      handleProcessingSuccess(data);
    }
  } catch (err) {
    showErrorScreen('Regenerate failed', err.message, 'generic', handleRegenerate);
    showScreen('playlist');
  } finally {
    analysisLoader?.classList.add('hidden');
  }
}

function showShareScreen() {
  const mount = document.getElementById('shareCardMount');
  if (!mount || !currentGeneration.metadata) return;
  const showWatermark = authState.user?.tier !== 'premium';
  const palette = (currentGeneration.metadata.dominantColorPalette || []).map(getTagColorHex);
  const card = buildShareCardDom({
    title: aestheticTitle?.textContent || 'Your moment',
    moodLine: currentGeneration.metadata.emotionalVibe || '',
    imageUrl: currentGeneration.imagePath,
    palette,
    playlistMeta: `${currentGeneration.tracks.length} tracks`,
    showWatermark
  });
  mount.innerHTML = '';
  mount.appendChild(card);
  showScreen('share');
}

async function handleDownloadShare() {
  const card = document.getElementById('shareCardExport');
  if (!card) return;
  await downloadShareCardPng(card);
}

async function handleCopyShareLink() {
  const url = currentGeneration.playlistUrl;
  if (!url) {
    savePlaylistToSpotify();
    return;
  }
  await copyPlaylistLink(url);
  alert('Link copied!');
}

async function handleInstagramStory() {
  const card = document.getElementById('shareCardExport');
  if (!card) return;
  const { rasterizeShareCard } = await import('./share-card.js');
  const dataUrl = await rasterizeShareCard(card, { width: 1080, height: 1920, pixelRatio: 1 });
  const link = document.createElement('a');
  link.download = 'momentai-story.png';
  link.href = dataUrl;
  link.click();
}

// Render Gemini visual metadata outputs
function renderAnalysisResults(metadata) {
  const vibeLabel = metadata.emotionalVibe
    ? metadata.emotionalVibe.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
    : 'Warm light, slow pace';

  const energyPct = Math.round(metadata.energy * 100);
  const energyBand = energyPct < 40 ? 'Low' : energyPct < 70 ? 'Mid' : 'High';
  const tempoFeel = metadata.acousticness > 0.6 ? '~72 BPM' : metadata.energy > 0.65 ? '~118 BPM' : '~92 BPM';

  if (aestheticTitle) {
    aestheticTitle.textContent = vibeLabel;
  }
  if (metricEnergy) {
    metricEnergy.textContent = `${energyBand} — ${energyPct}%`;
  }
  if (metricMood) {
    metricMood.textContent = vibeLabel.split(/[,·]/)[0].trim() || 'Wistful · warm';
  }
  const metricTempo = document.getElementById('metricTempo');
  if (metricTempo) {
    metricTempo.textContent = tempoFeel;
  }
  if (genresLabel) {
    genresLabel.innerHTML = '';
    metadata.seedGenres.forEach((genre) => {
      const chip = document.createElement('span');
      chip.className = 'genre-chip';
      chip.textContent = genre;
      genresLabel.appendChild(chip);
    });
  }

  if (analysisCard) {
    analysisCard.classList.add('is-ready');
    analysisCard.classList.remove('is-analyzing');
  }
  const curationCount = document.getElementById('curationCount');
  if (curationCount && currentGeneration?.tracks) {
    curationCount.textContent = `${currentGeneration.tracks.length || 0} tracks`;
  }

  if (colorSwatches) {
    colorSwatches.innerHTML = '';
    metadata.dominantColorPalette.slice(0, 4).forEach((color, i) => {
      const swatch = document.createElement('span');
      swatch.className = 'color-swatch';
      swatch.style.backgroundColor = getTagColorHex(color);
      swatch.style.setProperty('--stagger-delay', `${i * 60}ms`);
      swatch.title = color;
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
  if (cn.includes('blue') || cn.includes('ocean') || cn.includes('cool')) return '#2b2f3a';
  if (cn.includes('purple') || cn.includes('violet') || cn.includes('magenta')) return '#5a4a3a';
  if (cn.includes('pink') || cn.includes('pastel') || cn.includes('rose')) return '#d8b98a';
  if (cn.includes('cyan') || cn.includes('turquoise')) return '#3a4548';
  if (cn.includes('gold') || cn.includes('yellow') || cn.includes('warm') || cn.includes('sunny') || cn.includes('amber')) return '#e5a04d';
  if (cn.includes('orange') || cn.includes('sunset') || cn.includes('copper')) return '#b06a2e';
  if (cn.includes('green') || cn.includes('nature')) return '#4a5a42';
  if (cn.includes('red') || cn.includes('vintage')) return '#8a3f32';
  if (cn.includes('monochrome') || cn.includes('dark') || cn.includes('black')) return '#6b6156';
  return '#b06a2e';
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
        <button type="button" class="btn-play-preview" data-track-id="${escapeHtml(track.id)}" title="Play on Spotify" aria-label="Play ${escapeHtml(track.name)} on Spotify">▶</button>
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
    showErrorScreen("Export Failed", error.message, 'generic', () => confirmSavePlaylistToSpotify());
    setButtonLoading(btnSavePlaylist, false);
    btnSavePlaylist.textContent = "Save Playlist to Spotify";
  }
}

// Upgrade to Plus via Stripe Checkout
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
        showScreen('home');
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
