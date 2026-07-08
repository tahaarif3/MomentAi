import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import http from 'http';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const CONCURRENT_JOBS = 5; // Simulates 5 concurrent users generating playlists
const SERVER_URL = 'http://127.0.0.1:3000';
const TEST_IMAGE_PATH = path.join(__dirname, '../tests/assets/beach.png');

// Verify test image exists
if (!fs.existsSync(TEST_IMAGE_PATH)) {
  console.error(`Error: Test image not found at ${TEST_IMAGE_PATH}`);
  process.exit(1);
}

// Simple helper to sleep
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Helper to manually build boundary multipart form data (since native FormData in Node 18/20 can sometimes behave unexpectedly in HTTP requests depending on version)
function buildMultipartFormData(boundary, fileName, fileBuffer, mimeType, customPrompt) {
  const chunks = [];
  
  // Image field
  chunks.push(Buffer.from(`--${boundary}\r\n`));
  chunks.push(Buffer.from(`Content-Disposition: form-data; name="image"; filename="${fileName}"\r\n`));
  chunks.push(Buffer.from(`Content-Type: ${mimeType}\r\n\r\n`));
  chunks.push(fileBuffer);
  chunks.push(Buffer.from('\r\n'));

  // Custom prompt field
  chunks.push(Buffer.from(`--${boundary}\r\n`));
  chunks.push(Buffer.from('Content-Disposition: form-data; name="customPrompt"\r\n\r\n'));
  chunks.push(Buffer.from(customPrompt));
  chunks.push(Buffer.from('\r\n'));

  // Close boundary
  chunks.push(Buffer.from(`--${boundary}--\r\n`));

  return Buffer.concat(chunks);
}

// Helper to send HTTP requests using Node built-in http module
function postMultipart(urlStr, fileName, fileBuffer, mimeType, customPrompt) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const boundary = `----LoadTestBoundary${Math.random().toString(36).substring(2)}`;
    const body = buildMultipartFormData(boundary, fileName, fileBuffer, mimeType, customPrompt);

    const options = {
      method: 'POST',
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length,
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ status: res.statusCode, body: parsed });
        } catch (e) {
          reject(new Error(`Failed to parse JSON response: ${data}`));
        }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// Helper to send HTTP POST JSON request
function postJson(urlStr, payload) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const body = JSON.stringify(payload);

    const options = {
      method: 'POST',
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ status: res.statusCode, body: parsed });
        } catch (e) {
          reject(new Error(`Failed to parse JSON: ${data}`));
        }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// Custom EventSource listener for streaming updates using native Node http
function listenToJobStream(jobId, jobIndex, startTime) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${SERVER_URL}/api/playlist/job/${jobId}/stream`);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      headers: {
        'Accept': 'text/event-stream'
      }
    };

    const log = (msg) => {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`[Job ${jobIndex}] [+${elapsed}s] ${msg}`);
    };

    const req = http.get(options, (res) => {
      let buffer = '';

      res.on('data', (chunk) => {
        buffer += chunk.toString();
        
        // Split by SSE double newline separator
        const parts = buffer.split('\n\n');
        buffer = parts.pop(); // Keep last incomplete chunk in buffer

        for (const part of parts) {
          const lines = part.split('\n');
          let event = 'message';
          let data = '';

          for (const line of lines) {
            if (line.startsWith('event:')) {
              event = line.replace('event:', '').trim();
            } else if (line.startsWith('data:')) {
              data = line.replace('data:', '').trim();
            }
          }

          if (event === 'progress') {
            const progress = JSON.parse(data);
            log(`Progress: ${progress.message}`);
          } else if (event === 'retrying') {
            log(`⚠️ Rate Limited! Auto-retrying: ${JSON.parse(data).message}`);
          } else if (event === 'completed') {
            const result = JSON.parse(data);
            log(`✅ Generation completed! Resolved ${result.tracks.length} tracks.`);
            req.destroy();
            resolve(result);
          } else if (event === 'failed') {
            const err = JSON.parse(data);
            log(`❌ Failed: ${err.message}`);
            req.destroy();
            reject(new Error(err.message));
          }
        }
      });

      res.on('error', (err) => {
        log(`Stream Error: ${err.message}`);
        reject(err);
      });
    });

    req.on('error', (err) => {
      log(`Stream Connection Error: ${err.message}`);
      reject(err);
    });
  });
}

// Function to run a single user workflow (generate -> wait completion -> export/save)
async function runUserWorkflow(jobIndex, startTime) {
  const log = (msg) => {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[User ${jobIndex}] [+${elapsed}s] ${msg}`);
  };

  log(`Starting playlist request...`);
  
  // 1. Submit image to process queue
  const fileBuffer = fs.readFileSync(TEST_IMAGE_PATH);
  const customPrompt = `Summer Beach Party ${jobIndex}`;
  
  const submitRes = await postMultipart(
    `${SERVER_URL}/api/playlist/process`,
    `beach-${jobIndex}.png`,
    fileBuffer,
    'image/png',
    customPrompt
  );

  if (submitRes.status !== 202) {
    log(`❌ Failed to submit job. Status: ${submitRes.status}, Message: ${submitRes.body.message}`);
    throw new Error(submitRes.body.message);
  }

  const jobId = submitRes.body.jobId;
  log(`📥 Job accepted by worker queue! Job ID: ${jobId}`);

  // 2. Stream progress until completion
  const generationResult = await listenToJobStream(jobId, jobIndex, startTime);

  // 3. Export/Save playlist to Spotify Master Account
  log(`💾 Exporting generated playlist to Spotify...`);
  const trackUris = generationResult.tracks.map(t => t.uri);
  const playlistName = `MomentAI LoadTest #${jobIndex}`;
  const playlistDescription = `Automated high-traffic load test playlist. Visual mood: ${generationResult.metadata.emotionalVibe}`;

  const saveRes = await postJson(`${SERVER_URL}/api/playlist/save`, {
    playlistName,
    playlistDescription,
    trackUris,
    generationId: generationResult.generationId,
    coverImageBase64: null // Skip cover art for speed in load test
  });

  if (saveRes.status !== 200) {
    log(`❌ Failed to save playlist to Spotify. Status: ${saveRes.status}, Message: ${saveRes.body.message}`);
    throw new Error(saveRes.body.message);
  }

  log(`🚀 Playlist saved successfully to Spotify! URL: ${saveRes.body.playlistUrl}`);
  return saveRes.body.playlistUrl;
}

// Main runner for high-traffic load test
async function runLoadTest() {
  console.log(`================================================================`);
  console.log(`   MomentAI High-Traffic Queue Load Tester`);
  console.log(`   Target Server: ${SERVER_URL}`);
  console.log(`   Simulating: ${CONCURRENT_JOBS} concurrent users`);
  console.log(`================================================================`);

  const startTime = Date.now();
  const tasks = [];

  for (let i = 1; i <= CONCURRENT_JOBS; i++) {
    tasks.push(runUserWorkflow(i, startTime));
  }

  try {
    const playlistUrls = await Promise.all(tasks);
    
    console.log(`\n================================================================`);
    console.log(`✅ LOAD TEST SUCCESSFUL!`);
    console.log(`All ${CONCURRENT_JOBS} playlists generated and exported in: ${((Date.now() - startTime)/1000).toFixed(1)}s`);
    console.log(`Generated Playlists:`);
    playlistUrls.forEach((url, i) => {
      console.log(`  User #${i+1}: ${url}`);
    });
    console.log(`================================================================`);
    process.exit(0);
  } catch (err) {
    console.error(`\n❌ LOAD TEST FAILED:`, err.message);
    process.exit(1);
  }
}

// Start load test
runLoadTest();
