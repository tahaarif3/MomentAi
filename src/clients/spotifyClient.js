/**
 * Spotify API Client Module
 * 
 * Uses two authentication flows:
 * 1. Client Credentials — for catalog searches (no user context needed)
 * 2. Master Account — a single dedicated Spotify account that creates public playlists
 */

// ─── Master Account Token Cache ───────────────────────────────────────────────
let masterTokenCache = {
  accessToken: null,
  expiresAt: 0
};

let masterUserIdCache = null;

// ─── Client Credentials Token Cache ───────────────────────────────────────────
let clientTokenCache = {
  accessToken: null,
  expiresAt: 0
};

// Helper to base64 encode Spotify Client Credentials
function getBasicAuthHeader() {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("SPOTIFY_CLIENT_ID or SPOTIFY_CLIENT_SECRET is missing from environment variables.");
  }
  return 'Basic ' + Buffer.from(clientId + ':' + clientSecret).toString('base64');
}

// Shadow global fetch to automatically handle Spotify rate limits (429) and network retries
const fetch = async function spotifyFetch(url, options = {}, retries = 3) {
  const response = await globalThis.fetch(url, options);
  
  if (response.status === 401) {
    console.warn("[Spotify API] 401 Unauthorized received. Invalidating cached tokens.");
    clientTokenCache = { accessToken: null, expiresAt: 0 };
    masterTokenCache = { accessToken: null, expiresAt: 0 };
  }
  
  if (response.status === 429) {
    const retryAfterHeader = response.headers.get('Retry-After');
    let delaySeconds = retryAfterHeader ? parseInt(retryAfterHeader, 10) : 2;
    
    if (isNaN(delaySeconds)) {
      delaySeconds = 2;
    }
    
    const delayMs = (delaySeconds * 1000) + 200; // Add 200ms buffer
    
    // If the rate limit delay is excessive (more than 10 seconds), fail immediately
    // to prevent hanging Node.js and to stop hammering Spotify.
    if (delaySeconds > 10) {
      console.error(`[Spotify API] 429 Rate Limit: Spotify requested a long wait of ${delaySeconds} seconds. Failing immediately to prevent lockout.`);
      throw new Error(`Spotify API rate limit is too high (${delaySeconds}s). Please try again in a few minutes.`);
    }
    
    if (retries > 0) {
      console.warn(`[Spotify API] 429 Rate Limit. Waiting ${delayMs}ms... (Retries left: ${retries})`);
      await new Promise(resolve => setTimeout(resolve, delayMs));
      return spotifyFetch(url, options, retries - 1);
    }
  }
  
  return response;
};

/**
 * Fetch an Access Token using Spotify's Client Credentials flow.
 * Used for general catalog reading & recommendations without user OAuth.
 * @returns {Promise<string>} Spotify Access Token
 */
export async function getClientCredentialsToken() {
  if (process.env.NODE_ENV === 'test') {
    return 'mock_client_credentials_token';
  }

  // Return cached token if still valid (60s buffer)
  if (clientTokenCache.accessToken && Date.now() < (clientTokenCache.expiresAt - 60000)) {
    return clientTokenCache.accessToken;
  }

  console.log('Refreshing Spotify Client Credentials token...');
  const url = 'https://accounts.spotify.com/api/token';
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': getBasicAuthHeader(),
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      grant_type: 'client_credentials'
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Failed to obtain Spotify Client Credentials token: ${response.statusText} - ${errText}`);
  }

  const data = await response.json();
  clientTokenCache = {
    accessToken: data.access_token,
    expiresAt: Date.now() + (data.expires_in * 1000)
  };

  return clientTokenCache.accessToken;
}

/**
 * Get a fresh access token for the Master Spotify Account.
 * Uses the SPOTIFY_MASTER_REFRESH_TOKEN env var.
 * Caches the token in memory and auto-refreshes when expired.
 * @returns {Promise<string>} Master account access token
 */
export async function getMasterAccountToken() {
  if (process.env.NODE_ENV === 'test') {
    return 'mock_master_token';
  }

  const masterRefreshToken = process.env.SPOTIFY_MASTER_REFRESH_TOKEN;
  if (!masterRefreshToken) {
    throw new Error(
      'SPOTIFY_MASTER_REFRESH_TOKEN is not set. Run "node scripts/spotify-master-setup.js" to obtain it.'
    );
  }

  // Return cached token if still valid (60s buffer)
  if (masterTokenCache.accessToken && Date.now() < (masterTokenCache.expiresAt - 60000)) {
    return masterTokenCache.accessToken;
  }

  console.log('Refreshing Master Spotify Account token...');
  const tokenData = await refreshUserToken(masterRefreshToken);

  masterTokenCache = {
    accessToken: tokenData.access_token,
    expiresAt: Date.now() + (tokenData.expires_in * 1000)
  };

  return masterTokenCache.accessToken;
}

/**
 * Get the Spotify user ID of the Master Account.
 * Cached after first lookup.
 * @returns {Promise<string>} Master account Spotify user ID
 */
async function getMasterUserId() {
  if (masterUserIdCache) return masterUserIdCache;

  if (process.env.NODE_ENV === 'test') {
    masterUserIdCache = 'mock_master_user';
    return masterUserIdCache;
  }

  const token = await getMasterAccountToken();
  const response = await fetch('https://api.spotify.com/v1/me', {
    headers: { 'Authorization': `Bearer ${token}` }
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Failed to fetch master account profile: ${response.statusText} - ${errText}`);
  }

  const profile = await response.json();
  masterUserIdCache = profile.id;
  console.log(`Master Spotify Account: ${profile.display_name} (${profile.id})`);
  return masterUserIdCache;
}

/**
 * Create a public playlist on the Master Account, populate it with tracks,
 * and optionally upload cover art.
 * @param {string} name - Playlist name
 * @param {string} description - Playlist description
 * @param {string[]} trackUris - Array of Spotify track URIs
 * @param {string} [coverImageBase64] - Optional base64 JPEG cover image
 * @returns {Promise<{playlistId: string, playlistUrl: string}>}
 */
export async function createMasterPlaylist(name, description, trackUris, coverImageBase64 = null) {
  if (process.env.NODE_ENV === 'test') {
    console.log('[TEST] Mocking master playlist creation...');
    return {
      playlistId: 'mock_playlist_123',
      playlistUrl: 'https://open.spotify.com/playlist/mock_playlist_123'
    };
  }

  const token = await getMasterAccountToken();
  const masterUserId = await getMasterUserId();

  // Create public playlist on master account
  console.log(`Creating master playlist: "${name}" under account: ${masterUserId}`);
  const playlist = await createPlaylist(masterUserId, token, name, description, true);
  const playlistId = playlist.id;
  const playlistUrl = playlist.external_urls.spotify;

  // Add tracks
  if (trackUris && trackUris.length > 0) {
    console.log(`Adding ${trackUris.length} tracks to master playlist: ${playlistId}`);
    await addTracksToPlaylist(token, playlistId, trackUris);
  }

  // Upload cover art if provided
  if (coverImageBase64) {
    try {
      console.log(`Uploading cover art to master playlist: ${playlistId}`);
      await uploadPlaylistCover(token, playlistId, coverImageBase64);
    } catch (coverErr) {
      console.error('Failed to upload cover art to master playlist:', coverErr);
      // Non-fatal — the playlist is still created
    }
  }

  return { playlistId, playlistUrl };
}

/**
 * Refresh an expired User Access Token (used internally for master account)
 * @param {string} refreshToken - The stored user refresh token
 * @returns {Promise<object>} Token object { access_token, expires_in }
 */
export async function refreshUserToken(refreshToken) {
  const url = 'https://accounts.spotify.com/api/token';

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': getBasicAuthHeader(),
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Failed to refresh token: ${response.statusText} - ${errText}`);
  }

  return await response.json();
}

/**
 * Get Spotify Recommendations based on genres and visual weights.
 * @param {string} token - Spotify Access Token (client credentials or user OAuth)
 * @param {Array<string>} seedGenres - Array of seed genres (up to 5, we use 3)
 * @param {number} targetValence - Brightness (0.0 to 1.0)
 * @param {number} targetEnergy - Energy (0.0 to 1.0)
 * @param {number} targetAcousticness - Acousticness (0.0 to 1.0)
 * @returns {Promise<Array<object>>} List of recommended tracks
 */
export async function getRecommendations(token, seedGenres, targetValence, targetEnergy, targetAcousticness, customPrompt = '', emotionalVibe = '') {
  if (process.env.NODE_ENV === 'test') {
    console.log("[TEST] Mocking Spotify recommendations...");
    return [
      {
        id: "mock_track_1",
        uri: "spotify:track:mock_track_1",
        name: "Mock Track 1",
        artists: [{ name: "Mock Artist 1" }],
        album: {
          name: "Mock Album 1",
          images: [{ url: "https://via.placeholder.com/150" }, { url: "https://via.placeholder.com/150" }, { url: "https://via.placeholder.com/48" }]
        },
        duration_ms: 180000,
        preview_url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3"
      },
      {
        id: "mock_track_2",
        uri: "spotify:track:mock_track_2",
        name: "Mock Track 2",
        artists: [{ name: "Mock Artist 2" }],
        album: {
          name: "Mock Album 2",
          images: [{ url: "https://via.placeholder.com/150" }, { url: "https://via.placeholder.com/150" }, { url: "https://via.placeholder.com/48" }]
        },
        duration_ms: 200000,
        preview_url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3"
      }
    ];
  }

  // Directly forward to the search-based fallback engine to avoid unnecessary network API errors and delays
  return await getRecommendationsFallback(token, seedGenres, customPrompt, emotionalVibe);
}

/**
 * Fallback recommendation generator using Spotify Search API.
 * Searches for tracks matching the specified genres and blends them.
 */
async function getRecommendationsFallback(token, seedGenres, customPrompt = '', emotionalVibe = '') {
  if (!seedGenres || seedGenres.length === 0) {
    seedGenres = ['pop', 'indie', 'electronic'];
  }

  const cleanCustomPrompt = customPrompt && customPrompt.trim().length > 0 ? customPrompt.trim() : '';

  const tracksPool = [];
  const seenTrackIds = new Set();
  const genresToSearch = seedGenres.slice(0, 5); // limit to 5 genres max

  for (const genre of genresToSearch) {
    // If only 1 genre is provided, fetch 2 pages of 10 tracks to get 20. Otherwise 1 page of 10 is enough.
    const pagesToFetch = genresToSearch.length === 1 ? 2 : 1;
    const randomOffset = Math.floor(Math.random() * 8); // 0 to 7

    for (let page = 0; page < pagesToFetch; page++) {
      try {
        let query = '';
        if (genre === 'indian') {
          // 'indian' isn't supported by Spotify search genre filter, map to desi/bollywood keywords
          const vibe = emotionalVibe ? emotionalVibe.trim() : 'wedding celebration';
          query = `bollywood desi hindi punjabi ${vibe}`;
        } else {
          // Blend genre with emotional vibe to make search dynamic and unique per image
          const blend = emotionalVibe ? ` ${emotionalVibe.trim()}` : '';
          query = cleanCustomPrompt 
            ? `genre:"${genre}" ${cleanCustomPrompt}${blend}` 
            : `genre:"${genre}"${blend}`;
        }

        const url = `https://api.spotify.com/v1/search?${new URLSearchParams({
          q: query,
          type: 'track',
          limit: '10', // Max limit of 10
          offset: (page * 10 + randomOffset).toString()
        }).toString()}`;

        const response = await fetch(url, {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });

        if (response.ok) {
          const data = await response.json();
          let items = data.tracks?.items || [];

          // Fallback if combined query yields 0 results and customPrompt was present
          if (items.length === 0 && cleanCustomPrompt) {
            console.warn(`Combined search (genre:"${genre}" + customPrompt:"${cleanCustomPrompt}") returned 0 results. Trying query: "${cleanCustomPrompt}"...`);
            const fallbackUrl = `https://api.spotify.com/v1/search?${new URLSearchParams({
              q: cleanCustomPrompt,
              type: 'track',
              limit: '10',
              offset: (page * 10 + randomOffset).toString()
            }).toString()}`;
            const fallbackResponse = await fetch(fallbackUrl, {
              headers: { 'Authorization': `Bearer ${token}` }
            });
            if (fallbackResponse.ok) {
              const fallbackData = await fallbackResponse.json();
              items = fallbackData.tracks?.items || [];
            }
          }

          for (const item of items) {
            const name = item.name.toLowerCase();
            const isInstrumental = name.includes('instrumental') || name.includes('karaoke') || name.includes('tribute') || name.includes('piano version');
            if (!isInstrumental && !seenTrackIds.has(item.id)) {
              seenTrackIds.add(item.id);
              tracksPool.push({
                ...item,
                genreSrc: genre
              });
            }
          }
        } else {
          const errText = await response.text();
          console.warn(`Fallback search failed for genre "${genre}" (page ${page}): ${response.status} ${response.statusText} - ${errText}`);
        }
      } catch (err) {
        console.warn(`Error searching for genre "${genre}" (page ${page}):`, err);
      }
      await new Promise(resolve => setTimeout(resolve, 150));
    }
  }

  // Secondary fallback: keyword search if genre filters yield no results
  if (tracksPool.length === 0) {
    console.warn("Genre-specific search yielded 0 results. Trying general search with genre keywords...");
    for (const genre of genresToSearch) {
      const pagesToFetch = genresToSearch.length === 1 ? 2 : 1;
      const randomOffset = Math.floor(Math.random() * 5); // 0 to 4

      for (let page = 0; page < pagesToFetch; page++) {
        try {
          let query = '';
          if (genre === 'indian') {
            query = `bollywood desi hindi punjabi ${emotionalVibe || 'party'}`;
          } else {
            const blend = emotionalVibe ? ` ${emotionalVibe.trim()}` : '';
            query = cleanCustomPrompt || genre;
            query = `${query}${blend}`;
          }

          const url = `https://api.spotify.com/v1/search?${new URLSearchParams({
            q: query,
            type: 'track',
            limit: '10', // Max limit of 10
            offset: (page * 10 + randomOffset).toString()
          }).toString()}`;

          const response = await fetch(url, {
            headers: {
              'Authorization': `Bearer ${token}`
            }
          });

          if (response.ok) {
            const data = await response.json();
            const items = data.tracks?.items || [];
            for (const item of items) {
              const name = item.name.toLowerCase();
              const isInstrumental = name.includes('instrumental') || name.includes('karaoke') || name.includes('tribute') || name.includes('piano version');
              if (!isInstrumental && !seenTrackIds.has(item.id)) {
                seenTrackIds.add(item.id);
                tracksPool.push(item);
              }
            }
          } else {
            const errText = await response.text();
            console.warn(`General fallback search failed for "${genre}" (page ${page}): ${response.status} ${response.statusText} - ${errText}`);
          }
        } catch (err) {
          console.warn(`Error during general search for "${genre}" (page ${page}):`, err);
        }
        await new Promise(resolve => setTimeout(resolve, 150));
      }
    }
  }

  if (tracksPool.length === 0) {
    return [];
  }

  // Interleave tracks to ensure genre mix
  const interleavedTracks = [];
  const genreBuckets = {};
  
  for (const track of tracksPool) {
    const genre = track.genreSrc || 'general';
    if (!genreBuckets[genre]) {
      genreBuckets[genre] = [];
    }
    genreBuckets[genre].push(track);
  }

  const genres = Object.keys(genreBuckets);
  let hasMore = true;
  let index = 0;
  
  while (hasMore && interleavedTracks.length < 20) {
    hasMore = false;
    for (const g of genres) {
      if (index < genreBuckets[g].length) {
        interleavedTracks.push(genreBuckets[g][index]);
        hasMore = true;
      }
    }
    index++;
  }

  return interleavedTracks.slice(0, 20);
}

/**
 * Create a new Playlist on the user's Spotify account
 * @param {string} userId - Spotify User ID
 * @param {string} token - User Access Token
 * @param {string} name - Playlist Name
 * @param {string} description - Playlist Description
 * @returns {Promise<object>} Created Playlist object { id, external_urls: { spotify } }
 */
export async function createPlaylist(userId, token, name, description, isPublic = true) {
  const url = 'https://api.spotify.com/v1/me/playlists';
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      name: name,
      description: description,
      public: isPublic
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Failed to create playlist: ${response.statusText} - ${errText}`);
  }

  return await response.json();
}

/**
 * Add tracks to a playlist
 * @param {string} token - User Access Token
 * @param {string} playlistId - Spotify Playlist ID
 * @param {Array<string>} trackUris - Array of Spotify Track URIs (e.g. spotify:track:xxxx)
 * @returns {Promise<object>} Spotify response { snapshot_id }
 */
export async function addTracksToPlaylist(token, playlistId, trackUris) {
  const url = `https://api.spotify.com/v1/playlists/${playlistId}/items`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      uris: trackUris
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Failed to add tracks to playlist: ${response.statusText} - ${errText}`);
  }

  return await response.json();
}

/**
 * Upload a custom playlist cover image (JPEG, base64 encoded, max 256KB)
 * @param {string} token - User Access Token
 * @param {string} playlistId - Spotify Playlist ID
 * @param {string} base64Image - Base64 encoded JPEG image data
 * @returns {Promise<void>} Resolves when upload succeeds
 */
export async function uploadPlaylistCover(token, playlistId, base64Image) {
  let cleanBase64 = base64Image;
  if (base64Image.includes(';base64,')) {
    cleanBase64 = base64Image.split(';base64,')[1];
  }

  const url = `https://api.spotify.com/v1/playlists/${playlistId}/images`;
  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'image/jpeg'
    },
    body: cleanBase64
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Failed to upload playlist cover: ${response.statusText} - ${errText}`);
  }
}

/**
 * Search Spotify for an artist by name and retrieve their top tracks.
 * @param {string} token - Spotify Access Token
 * @param {string} artistName - Name of the artist to query
 * @returns {Promise<Array<object>>} List of top tracks by the artist
 */
export async function getArtistTopTracks(token, artistName) {
  if (process.env.NODE_ENV === 'test') {
    console.log("[TEST] Mocking Spotify artist top tracks for:", artistName);
    return [
      {
        id: "mock_artist_track_1",
        uri: "spotify:track:mock_artist_track_1",
        name: `Mock Song 1 by ${artistName}`,
        artists: [{ name: artistName }],
        album: {
          name: "Mock Artist Album 1",
          images: [
            { url: "https://via.placeholder.com/150" },
            { url: "https://via.placeholder.com/150" },
            { url: "https://via.placeholder.com/48" }
          ]
        },
        duration_ms: 210000,
        preview_url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3"
      },
      {
        id: "mock_artist_track_2",
        uri: "spotify:track:mock_artist_track_2",
        name: `Mock Song 2 by ${artistName}`,
        artists: [{ name: artistName }],
        album: {
          name: "Mock Artist Album 2",
          images: [
            { url: "https://via.placeholder.com/150" },
            { url: "https://via.placeholder.com/150" },
            { url: "https://via.placeholder.com/48" }
          ]
        },
        duration_ms: 195000,
        preview_url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3"
      }
    ];
  }

  try {
    const query = `artist:"${artistName}"`;
    const url = `https://api.spotify.com/v1/search?${new URLSearchParams({
      q: query,
      type: 'track',
      limit: '10'
    }).toString()}`;

    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    if (!response.ok) {
      const errText = await response.text();
      console.warn(`Spotify artist track search failed for "${artistName}":`, errText);
      // Fallback: search simply by artistName
      const fallbackUrl = `https://api.spotify.com/v1/search?${new URLSearchParams({
        q: artistName,
        type: 'track',
        limit: '10'
      }).toString()}`;
      const fallbackResponse = await fetch(fallbackUrl, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (fallbackResponse.ok) {
        const fallbackData = await fallbackResponse.json();
        return fallbackData.tracks?.items || [];
      }
      return [];
    }

    const data = await response.json();
    let tracks = data.tracks?.items || [];
    if (tracks.length === 0) {
      console.warn(`Structured search for artist:"${artistName}" returned 0 results. Trying general search...`);
      const fallbackUrl = `https://api.spotify.com/v1/search?${new URLSearchParams({
        q: artistName,
        type: 'track',
        limit: '10'
      }).toString()}`;
      const fallbackResponse = await fetch(fallbackUrl, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (fallbackResponse.ok) {
        const fallbackData = await fallbackResponse.json();
        tracks = fallbackData.tracks?.items || [];
      }
    }
    return tracks;
  } catch (error) {
    console.error(`Error fetching artist top tracks for "${artistName}":`, error);
    return [];
  }
}

/**
 * Search Spotify for tracks matching a query string.
 * @param {string} token - Spotify Access Token
 * @param {string} query - The search query
 * @param {number} [limit=10] - Number of results to return
 * @returns {Promise<Array<object>>} List of matching tracks
 */
export async function searchTracks(token, query, limit = 10) {
  if (process.env.NODE_ENV === 'test') {
    console.log("[TEST] Mocking Spotify track search for:", query);
    return [
      {
        id: "mock_search_track_1",
        uri: "spotify:track:mock_search_track_1",
        name: `Mock Search Song 1 for "${query}"`,
        artists: [{ name: "Mock Artist A" }],
        album: {
          name: "Mock Search Album A",
          images: [
            { url: "https://via.placeholder.com/150" },
            { url: "https://via.placeholder.com/150" },
            { url: "https://via.placeholder.com/48" }
          ]
        },
        duration_ms: 220000,
        preview_url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3"
      },
      {
        id: "mock_search_track_2",
        uri: "spotify:track:mock_search_track_2",
        name: `Mock Search Song 2 for "${query}"`,
        artists: [{ name: "Mock Artist B" }],
        album: {
          name: "Mock Search Album B",
          images: [
            { url: "https://via.placeholder.com/150" },
            { url: "https://via.placeholder.com/150" },
            { url: "https://via.placeholder.com/48" }
          ]
        },
        duration_ms: 190000,
        preview_url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3"
      }
    ];
  }

  try {
    const url = `https://api.spotify.com/v1/search?${new URLSearchParams({
      q: query,
      type: 'track',
      limit: limit.toString()
    }).toString()}`;

    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    if (!response.ok) {
      const errText = await response.text();
      console.warn(`Spotify track search failed for "${query}":`, errText);
      return [];
    }

    const data = await response.json();
    return data.tracks?.items || [];
  } catch (error) {
    console.error(`Error searching tracks for "${query}":`, error);
    return [];
  }
}

/**
 * Fetch playlist details from Spotify
 * @param {string} token - Access token
 * @param {string} playlistId - Spotify Playlist ID
 */
export async function getPlaylistDetails(token, playlistId) {
  if (process.env.NODE_ENV === 'test') {
    return {
      id: playlistId,
      name: "Mock Playlist",
      description: "This is a mock imported playlist description.",
      images: [{ url: "https://via.placeholder.com/300" }],
      external_urls: { spotify: `https://open.spotify.com/playlist/${playlistId}` }
    };
  }

  const url = `https://api.spotify.com/v1/playlists/${playlistId}?fields=id,name,description,images,external_urls`;
  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Failed to fetch playlist details: ${response.statusText} - ${errText}`);
  }

  return await response.json();
}

/**
 * Fetch tracks in a Spotify playlist (with pagination)
 * @param {string} token - Access token
 * @param {string} playlistId - Spotify Playlist ID
 * @returns {Promise<Array<object>>} List of track objects
 */
export async function getPlaylistTracks(token, playlistId) {
  if (process.env.NODE_ENV === 'test') {
    return [
      {
        id: "mock_import_track_1",
        uri: "spotify:track:mock_import_track_1",
        name: "Mock Imported Song 1",
        artists: [{ name: "Mock Artist A" }],
        album: {
          name: "Mock Album A",
          images: [
            { url: "https://via.placeholder.com/150" },
            { url: "https://via.placeholder.com/150" },
            { url: "https://via.placeholder.com/48" }
          ]
        },
        duration_ms: 180000,
        preview_url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3"
      },
      {
        id: "mock_import_track_2",
        uri: "spotify:track:mock_import_track_2",
        name: "Mock Imported Song 2",
        artists: [{ name: "Mock Artist B" }],
        album: {
          name: "Mock Album B",
          images: [
            { url: "https://via.placeholder.com/150" },
            { url: "https://via.placeholder.com/150" },
            { url: "https://via.placeholder.com/48" }
          ]
        },
        duration_ms: 210000,
        preview_url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3"
      }
    ];
  }

  let url = `https://api.spotify.com/v1/playlists/${playlistId}/items?limit=100`;
  const tracks = [];

  while (url) {
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Failed to fetch playlist tracks: ${response.statusText} - ${errText}`);
    }

    const data = await response.json();
    const items = data.items || [];
    for (const item of items) {
      if (item.track) {
        tracks.push(item.track);
      }
    }
    url = data.next;
  }

  return tracks;
}

/**
 * Search Spotify for a specific track by its title and artist.
 * Uses exact field matches first, falling back to a loose general query.
 * @param {string} token - Spotify access token
 * @param {string} title - Song title
 * @param {string} artist - Artist name
 * @returns {Promise<object|null>} Track object, or null if not found
 */
export async function searchTrackByDetails(token, title, artist) {
  if (process.env.NODE_ENV === 'test') {
    return {
      id: `mock_track_${Buffer.from(title).toString('hex').slice(0, 8)}`,
      uri: `spotify:track:mock_track_${Buffer.from(title).toString('hex').slice(0, 8)}`,
      name: title,
      artists: [{ name: artist }],
      album: {
        name: "Mock Album",
        images: [
          { url: "https://via.placeholder.com/150" },
          { url: "https://via.placeholder.com/150" },
          { url: "https://via.placeholder.com/48" }
        ]
      },
      duration_ms: 180000,
      preview_url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3"
    };
  }

  // Construct structured query like: track:"Title" artist:"Artist"
  const query = `track:"${title}" artist:"${artist}"`;
  const url = `https://api.spotify.com/v1/search?${new URLSearchParams({
    q: query,
    type: 'track',
    limit: '1'
  }).toString()}`;

  try {
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    if (response.ok) {
      const data = await response.json();
      const items = data.tracks?.items || [];
      if (items.length > 0) {
        return items[0];
      }
      
      // Fallback: search more generally if exact track/artist query fails
      const fallbackQuery = `${title} ${artist}`;
      const fallbackUrl = `https://api.spotify.com/v1/search?${new URLSearchParams({
        q: fallbackQuery,
        type: 'track',
        limit: '1'
      }).toString()}`;
      
      const fallbackResponse = await fetch(fallbackUrl, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      if (fallbackResponse.ok) {
        const fallbackData = await fallbackResponse.json();
        const fallbackItems = fallbackData.tracks?.items || [];
        if (fallbackItems.length > 0) {
          return fallbackItems[0];
        }
      }
    }
  } catch (err) {
    console.warn(`Failed to search track "${title}" by "${artist}":`, err);
  }
  return null;
}


