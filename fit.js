// ── Google Fit Integration ──
// Uses Google Identity Services (GSI) for OAuth 2.0
// Fetches heart rate + SpO2 from Google Fit REST API

const FIT_SCOPES = 'https://www.googleapis.com/auth/fitness.heart_rate.read https://www.googleapis.com/auth/fitness.oxygen_saturation.read';
const FIT_API = 'https://www.googleapis.com/fitness/v1/users/me/dataset:aggregate';

let fitTokenClient = null;
let fitAccessToken = null;
let fitTokenExpiry = 0;
let fitRefreshTimer = null;
let fitLastUpdate = 0;
let fitConnected = false;

// ── Init ──
function initFit() {
  // Restore token from storage
  const stored = localStorage.getItem('breathe_fit_token');
  if (stored) {
    const { token, expiry } = JSON.parse(stored);
    if (expiry > Date.now()) {
      fitAccessToken = token;
      fitTokenExpiry = expiry;
      fitConnected = true;
      onFitConnected();
      return;
    }
  }
  showFitConnect();
}

// ── GSI Token Client ──
function setupTokenClient() {
  if (fitTokenClient) return;
  if (typeof google === 'undefined' || !google.accounts) {
    console.warn('GSI not loaded yet');
    return;
  }
  fitTokenClient = google.accounts.oauth2.initTokenClient({
    client_id: CONFIG.GOOGLE_CLIENT_ID,
    scope: FIT_SCOPES,
    callback: handleTokenResponse,
  });
}

function handleTokenResponse(response) {
  if (response.error) {
    console.error('Fit auth error:', response.error);
    showFitConnect('Connection failed. Tap to retry.');
    return;
  }
  fitAccessToken = response.access_token;
  fitTokenExpiry = Date.now() + (response.expires_in * 1000) - 60000; // refresh 1 min early
  fitConnected = true;

  localStorage.setItem('breathe_fit_token', JSON.stringify({
    token: fitAccessToken,
    expiry: fitTokenExpiry
  }));

  onFitConnected();
}

// ── Connect / Disconnect UI ──
function showFitConnect(msg) {
  const btn = document.getElementById('fit-connect-btn');
  if (btn) {
    btn.style.display = 'flex';
    btn.textContent = msg || 'Connect Google Fit';
  }
  updateSourceLabels('manual');
}

function onFitConnected() {
  const btn = document.getElementById('fit-connect-btn');
  if (btn) btn.style.display = 'none';

  fetchFitData();
  clearInterval(fitRefreshTimer);
  fitRefreshTimer = setInterval(() => {
    ensureToken().then(() => fetchFitData());
  }, CONFIG.FIT_REFRESH_MS);
}

function connectFit() {
  if (!CONFIG.GOOGLE_CLIENT_ID || CONFIG.GOOGLE_CLIENT_ID === 'YOUR_GOOGLE_CLIENT_ID') {
    showFitConnect('Set GOOGLE_CLIENT_ID in config.js');
    console.error('Google Fit: GOOGLE_CLIENT_ID not configured in config.js');
    return;
  }
  if (typeof google === 'undefined' || !google.accounts) {
    showFitConnect('Google not loaded. Check connection.');
    console.error('Google Fit: GSI library not loaded');
    return;
  }
  setupTokenClient();
  if (!fitTokenClient) {
    showFitConnect('Loading Google... tap again');
    return;
  }
  try {
    fitTokenClient.requestAccessToken();
  } catch (err) {
    console.error('Google Fit: OAuth request failed', err);
    showFitConnect('Connection failed. Tap to retry.');
  }
}

function disconnectFit() {
  fitAccessToken = null;
  fitTokenExpiry = 0;
  fitConnected = false;
  clearInterval(fitRefreshTimer);
  localStorage.removeItem('breathe_fit_token');
  showFitConnect();
}

// ── Token Refresh ──
async function ensureToken() {
  if (fitAccessToken && fitTokenExpiry > Date.now()) return;
  // Token expired — need user to re-auth
  if (fitTokenClient) {
    fitTokenClient.requestAccessToken();
  } else {
    disconnectFit();
  }
}

// ── Fetch Vitals ──
async function fetchFitData() {
  if (!fitAccessToken) return;

  const now = Date.now();
  const body = {
    aggregateBy: [
      { dataTypeName: 'com.google.heart_rate.bpm' },
      { dataTypeName: 'com.google.oxygen_saturation' }
    ],
    bucketByTime: { durationMillis: 300000 },
    startTimeMillis: now - 300000,
    endTimeMillis: now
  };

  try {
    const res = await fetch(FIT_API, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${fitAccessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    if (res.status === 401) {
      disconnectFit();
      return;
    }

    if (!res.ok) throw new Error(`Fit API ${res.status}`);

    const json = await res.json();
    let newBpm = null;
    let newSpo2 = null;

    for (const bucket of (json.bucket || [])) {
      for (const ds of (bucket.dataset || [])) {
        for (const pt of (ds.point || [])) {
          if (pt.dataTypeName === 'com.google.heart_rate.bpm') {
            const val = pt.value?.[0]?.fpVal;
            if (val) newBpm = Math.round(val);
          }
          if (pt.dataTypeName === 'com.google.oxygen_saturation') {
            const val = pt.value?.[0]?.fpVal;
            if (val) newSpo2 = Math.round(val);
          }
        }
      }
    }

    fitLastUpdate = now;

    if (newBpm !== null || newSpo2 !== null) {
      onFitDataReceived(newBpm, newSpo2);
    } else {
      // No new data — keep current values, update timestamp
      updateFitTimestamp();
    }
  } catch (err) {
    console.warn('Fit fetch failed:', err);
    updateFitTimestamp();
  }
}

// ── Callbacks (implemented in app.js) ──
function onFitDataReceived(newBpm, newSpo2) {
  // Overridden in app.js
}

function updateSourceLabels(source) {
  // Overridden in app.js
}

function updateFitTimestamp() {
  // Overridden in app.js
}
