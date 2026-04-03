// ── Google Fit Integration ──
// Uses Google Identity Services (GSI) for OAuth 2.0
// Redirect mode — works on mobile, watch, and desktop

const FIT_SCOPES = 'https://www.googleapis.com/auth/fitness.heart_rate.read https://www.googleapis.com/auth/fitness.oxygen_saturation.read';
const FIT_API = 'https://www.googleapis.com/fitness/v1/users/me/dataset:aggregate';

let fitAccessToken = null;
let fitTokenExpiry = 0;
let fitRefreshTimer = null;
let fitLastUpdate = 0;
let fitConnected = false;

// ── Init ──
function initFit() {
  // 1. Check if returning from OAuth redirect (token in URL hash)
  if (window.location.hash) {
    const params = new URLSearchParams(window.location.hash.substring(1));
    const token = params.get('access_token');
    const expiresIn = params.get('expires_in');
    if (token) {
      fitAccessToken = token;
      fitTokenExpiry = Date.now() + (parseInt(expiresIn, 10) * 1000) - 60000;
      fitConnected = true;
      localStorage.setItem('breathe_fit_token', JSON.stringify({
        token: fitAccessToken,
        expiry: fitTokenExpiry
      }));
      // Clean up URL hash
      history.replaceState(null, '', window.location.pathname);
      onFitConnected();
      return;
    }
  }

  // 2. Check stored token
  const stored = localStorage.getItem('breathe_fit_token');
  if (stored) {
    try {
      const { token, expiry } = JSON.parse(stored);
      if (expiry > Date.now()) {
        fitAccessToken = token;
        fitTokenExpiry = expiry;
        fitConnected = true;
        onFitConnected();
        return;
      }
    } catch (e) {
      localStorage.removeItem('breathe_fit_token');
    }
  }

  showFitConnect();
}

// ── Connect via Redirect ──
function connectFit() {
  if (!CONFIG.GOOGLE_CLIENT_ID || CONFIG.GOOGLE_CLIENT_ID === 'YOUR_GOOGLE_CLIENT_ID') {
    showFitConnect('Set GOOGLE_CLIENT_ID in config.js');
    console.error('Google Fit: GOOGLE_CLIENT_ID not configured');
    return;
  }

  // Build OAuth URL and redirect
  const redirectUri = window.location.origin + window.location.pathname;
  const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
    client_id: CONFIG.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'token',
    scope: FIT_SCOPES,
    include_granted_scopes: 'true',
    prompt: 'consent'
  }).toString();

  window.location.href = authUrl;
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
    if (fitAccessToken && fitTokenExpiry > Date.now()) {
      fetchFitData();
    } else {
      disconnectFit();
      showFitConnect('Session expired. Tap to reconnect.');
    }
  }, CONFIG.FIT_REFRESH_MS);
}

function disconnectFit() {
  fitAccessToken = null;
  fitTokenExpiry = 0;
  fitConnected = false;
  clearInterval(fitRefreshTimer);
  localStorage.removeItem('breathe_fit_token');
  showFitConnect();
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
      showFitConnect('Session expired. Tap to reconnect.');
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
      updateFitTimestamp();
    }
  } catch (err) {
    console.warn('Fit fetch failed:', err);
    updateFitTimestamp();
  }
}

// ── Callbacks (overridden in app.js) ──
function onFitDataReceived(newBpm, newSpo2) {}
function updateSourceLabels(source) {}
function updateFitTimestamp() {}
