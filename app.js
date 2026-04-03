// ── Debug Logger (temporary — tap status bar 5x to show) ──
let debugTaps = 0;
function dbg(msg) {
  console.log('[Breathe]', msg);
  const el = document.getElementById('debug-log');
  if (el) {
    el.textContent += new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit'}) + ' ' + msg + '\n';
    el.scrollTop = el.scrollHeight;
  }
}
function toggleDebug() {
  debugTaps++;
  if (debugTaps >= 5) {
    const el = document.getElementById('debug-log');
    if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none';
    debugTaps = 0;
  }
  setTimeout(() => { debugTaps = 0; }, 3000);
}

// ── State ──
let bpm = 72;
let spo2 = 98;
let aqi = null;
let aqiLabel = '';
let aqiData = null;
let currentSource = 'manual'; // 'manual' or 'google_fit'
let saveTimer = null;
let currentRange = 14;
let trendChart = null;

// ── Storage ──
function getReadings() {
  return JSON.parse(localStorage.getItem('breathe_readings') || '[]');
}
function saveReading(entry) {
  const readings = getReadings();
  readings.push(entry);
  localStorage.setItem('breathe_readings', JSON.stringify(readings));
}
function getEvents() {
  return JSON.parse(localStorage.getItem('breathe_events') || '[]');
}
function saveEvent(entry) {
  const events = getEvents();
  events.push(entry);
  localStorage.setItem('breathe_events', JSON.stringify(events));
}

// ── View Switching ──
function showView(view) {
  document.getElementById('monitor').classList.toggle('hidden', view !== 'monitor');
  document.getElementById('trends').classList.toggle('hidden', view !== 'trends');
  document.getElementById('nav-monitor').classList.toggle('active', view === 'monitor');
  document.getElementById('nav-trends').classList.toggle('active', view === 'trends');
  if (view === 'trends') renderTrends();
}

// ── Number Pop ──
function popValue(el) {
  el.classList.add('pop');
  setTimeout(() => el.classList.remove('pop'), 120);
}

// ── BPM ──
function adjustBpm(delta) {
  bpm = Math.max(40, Math.min(200, bpm + delta));
  const el = document.getElementById('bpm-value');
  el.textContent = bpm;
  popValue(el);
  currentSource = 'manual';
  updateSourceLabel('bpm', 'manual');
  applyBpmColor();
  scheduleSave();
}

function applyBpmColor() {
  const el = document.getElementById('bpm-value');
  el.classList.remove('status-good', 'status-warning', 'status-danger');
  if (bpm > 120) {
    el.classList.add('status-danger');
  } else if (bpm < 60 || bpm > 100) {
    el.classList.add('status-warning');
  } else {
    el.classList.add('status-good');
  }
}

// ── SpO2 ──
function adjustSpo2(delta) {
  spo2 = Math.max(70, Math.min(100, spo2 + delta));
  const el = document.getElementById('spo2-value');
  el.textContent = spo2;
  popValue(el);
  currentSource = 'manual';
  updateSourceLabel('spo2', 'manual');
  applySpo2Color();
  scheduleSave();
}

function applySpo2Color() {
  const el = document.getElementById('spo2-value');
  el.classList.remove('status-good', 'status-warning', 'status-danger');
  if (spo2 >= 95) {
    el.classList.add('status-good');
  } else if (spo2 >= 90) {
    el.classList.add('status-warning');
  } else {
    el.classList.add('status-danger');
  }
}

// ── Source Labels ──
function updateSourceLabel(metric, source, timestamp) {
  const el = document.getElementById(`${metric}-source`);
  if (!el) return;
  el.classList.toggle('fit-source', source === 'google_fit');
  if (source === 'google_fit') {
    const time = timestamp
      ? new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    el.textContent = `via Google Fit \u00b7 ${time}`;
  } else {
    el.textContent = 'manual';
  }
}

// ── Override fit.js callbacks ──
onFitDataReceived = function(newBpm, newSpo2) {
  dbg('FIT DATA RECEIVED: bpm=' + newBpm + ' spo2=' + newSpo2);
  currentSource = 'google_fit';
  const now = Date.now();

  if (newBpm !== null) {
    bpm = newBpm;
    const el = document.getElementById('bpm-value');
    el.textContent = bpm;
    popValue(el);
    applyBpmColor();
    updateSourceLabel('bpm', 'google_fit', now);
  }

  if (newSpo2 !== null) {
    spo2 = newSpo2;
    const el = document.getElementById('spo2-value');
    el.textContent = spo2;
    popValue(el);
    applySpo2Color();
    updateSourceLabel('spo2', 'google_fit', now);
  }

  // Auto-save on Fit refresh
  saveReading({
    ts: now,
    bpm,
    spo2,
    aqi: aqi || 0,
    aqiLabel: aqiLabel || 'Unknown',
    source: 'google_fit'
  });
};

updateSourceLabels = function(source) {
  updateSourceLabel('bpm', source);
  updateSourceLabel('spo2', source);
};

updateFitTimestamp = function() {
  if (fitLastUpdate) {
    updateSourceLabel('bpm', 'google_fit', fitLastUpdate);
    updateSourceLabel('spo2', 'google_fit', fitLastUpdate);
  }
};

onFitNoData = function() {
  dbg('FIT: connected but NO DATA returned');
  const bpmSrc = document.getElementById('bpm-source');
  const spo2Src = document.getElementById('spo2-source');
  if (bpmSrc) { bpmSrc.textContent = 'Fit connected \u00b7 no recent data'; bpmSrc.classList.add('fit-source'); }
  if (spo2Src) { spo2Src.textContent = 'Fit connected \u00b7 no recent data'; spo2Src.classList.add('fit-source'); }
};

// ── Auto-save (debounced 3s) ──
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveReading({
      ts: Date.now(),
      bpm,
      spo2,
      aqi: aqi || 0,
      aqiLabel: aqiLabel || 'Unknown',
      source: currentSource
    });
  }, 3000);
}

// ── AQI ──
function aqiStatus(val) {
  if (val <= 50) return 'good';
  if (val <= 100) return 'warning';
  return 'danger';
}

function aqiLabelFromValue(val) {
  if (val <= 50) return 'Good';
  if (val <= 100) return 'Moderate';
  if (val <= 150) return 'Unhealthy for Sensitive';
  if (val <= 200) return 'Unhealthy';
  if (val <= 300) return 'Very Unhealthy';
  return 'Hazardous';
}

async function getLocation() {
  dbg('getLocation: trying browser geolocation...');
  try {
    const pos = await new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: false,
        timeout: 8000
      });
    });
    dbg('getLocation: browser OK lat=' + pos.coords.latitude.toFixed(2) + ' lng=' + pos.coords.longitude.toFixed(2));
    return { lat: pos.coords.latitude, lng: pos.coords.longitude };
  } catch (e) {
    dbg('getLocation: browser failed: ' + (e.message || e.code));
  }

  dbg('getLocation: trying ipwho.is fallback...');
  try {
    const res = await fetch('https://ipwho.is/');
    dbg('getLocation: ipwho.is status=' + res.status);
    if (res.ok) {
      const json = await res.json();
      dbg('getLocation: ipwho.is success=' + json.success + ' lat=' + json.latitude + ' lng=' + json.longitude);
      if (json.success && json.latitude && json.longitude) {
        return { lat: json.latitude, lng: json.longitude };
      }
    }
  } catch (e) {
    dbg('getLocation: ipwho.is failed: ' + e.message);
  }

  dbg('getLocation: ALL FAILED');
  return null;
}

async function fetchAqi() {
  const cached = localStorage.getItem('breathe_aqi_cache');
  if (cached) {
    const { data, ts } = JSON.parse(cached);
    if (Date.now() - ts < CONFIG.AQI_REFRESH_MS) {
      applyAqi(data);
      return;
    }
  }

  try {
    const loc = await getLocation();
    if (!loc) throw new Error('No location available');

    const res = await fetch(
      `https://api.ambeedata.com/latest/by-lat-lng?lat=${loc.lat}&lng=${loc.lng}`,
      { headers: { 'x-api-key': CONFIG.AMBEE_KEY, 'Content-type': 'application/json' } }
    );

    if (!res.ok) throw new Error(`API ${res.status}`);
    const json = await res.json();
    const station = json.stations?.[0] || {};

    const data = {
      aqi: Math.round(station.AQI || 0),
      label: station.aqiInfo?.category || aqiLabelFromValue(station.AQI || 0),
      pm25: station.PM25?.toFixed(1),
      pm10: station.PM10?.toFixed(1),
      no2: station.NO2?.toFixed(1),
      co: station.CO?.toFixed(1)
    };

    localStorage.setItem('breathe_aqi_cache', JSON.stringify({ data, ts: Date.now() }));
    applyAqi(data);
    updateStatus('live', 'AQI live');
  } catch (err) {
    console.warn('AQI fetch failed:', err);
    document.getElementById('aqi-value').textContent = '--';
    const pill = document.getElementById('aqi-pill');
    pill.textContent = 'Allow location or check connection';
    pill.className = 'aqi-pill';
    updateStatus('error', 'AQI unavailable');
  }
}

function applyAqi(data) {
  aqi = data.aqi;
  aqiLabel = data.label;
  aqiData = data;

  const status = aqiStatus(aqi);
  const el = document.getElementById('aqi-value');
  el.textContent = aqi;
  el.classList.remove('status-good', 'status-warning', 'status-danger');
  el.classList.add(`status-${status}`);

  const pill = document.getElementById('aqi-pill');
  pill.textContent = data.label;
  pill.className = `aqi-pill pill-${status}`;

  const details = document.getElementById('aqi-details');
  details.innerHTML = '';
  if (data.pm25) details.innerHTML += `<div class="pollutant">PM2.5 <span>${data.pm25}</span></div>`;
  if (data.pm10) details.innerHTML += `<div class="pollutant">PM10 <span>${data.pm10}</span></div>`;
  if (data.no2) details.innerHTML += `<div class="pollutant">NO\u2082 <span>${data.no2}</span></div>`;
  if (data.co) details.innerHTML += `<div class="pollutant">CO <span>${data.co}</span></div>`;

  document.getElementById('last-aqi-time').textContent =
    `AQI ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  updateStatus('live', 'AQI live');
}

function updateStatus(state, text) {
  const dot = document.getElementById('status-dot');
  const label = document.getElementById('status-text');
  label.textContent = text;
  dot.style.background = state === 'live' ? 'var(--good)'
    : state === 'error' ? 'var(--danger)'
    : 'var(--text-muted)';
}

// ── Breathless Button ──
function logBreathless() {
  if (navigator.vibrate) navigator.vibrate([100, 50, 100]);

  const btn = document.getElementById('breathless-btn');
  btn.classList.add('pressed');
  setTimeout(() => btn.classList.remove('pressed'), 600);

  const now = Date.now();
  const time = new Date(now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const confirm = document.getElementById('breathless-confirm');
  confirm.textContent = `Logged ${time}`;
  confirm.classList.add('show');
  setTimeout(() => confirm.classList.remove('show'), 2000);

  const event = {
    ts: now,
    bpm,
    spo2,
    aqi: aqi || 0,
    aqiLabel: aqiLabel || 'Unknown'
  };
  saveEvent(event);
  renderRecentEvents();
}

// ── Recent Event Chips ──
function renderRecentEvents() {
  const events = getEvents();
  const recent = events.sort((a, b) => b.ts - a.ts).slice(0, 2);
  const container = document.getElementById('recent-events');

  if (recent.length === 0) {
    container.innerHTML = '';
    return;
  }

  container.innerHTML = recent.map(e => {
    const time = new Date(e.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const date = new Date(e.ts).toLocaleDateString([], { month: 'short', day: 'numeric' });
    return `<div class="event-chip">${date} ${time} <span class="chip-aqi">AQI ${e.aqi}</span></div>`;
  }).join('');
}

// ── Trends ──
function setRange(days, btn) {
  currentRange = days;
  document.querySelectorAll('.range-toggle button').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  renderTrends();
}

function renderTrends() {
  const readings = getReadings();
  const events = getEvents();
  const now = Date.now();
  const cutoff = now - currentRange * 86400000;

  // Day buckets
  const days = {};
  for (let i = 0; i < currentRange; i++) {
    const d = new Date(now - i * 86400000);
    const key = d.toISOString().slice(0, 10);
    days[key] = { bpmS: 0, bpmC: 0, spo2S: 0, spo2C: 0, aqiS: 0, aqiC: 0, ev: 0 };
  }

  readings.filter(r => r.ts >= cutoff).forEach(r => {
    const key = new Date(r.ts).toISOString().slice(0, 10);
    if (!days[key]) return;
    days[key].bpmS += r.bpm; days[key].bpmC++;
    days[key].spo2S += r.spo2; days[key].spo2C++;
    if (r.aqi) { days[key].aqiS += r.aqi; days[key].aqiC++; }
  });

  events.filter(e => e.ts >= cutoff).forEach(e => {
    const key = new Date(e.ts).toISOString().slice(0, 10);
    if (days[key]) days[key].ev++;
  });

  const labels = Object.keys(days).sort();
  const bpmData = labels.map(k => days[k].bpmC ? Math.round(days[k].bpmS / days[k].bpmC) : null);
  const spo2Data = labels.map(k => days[k].spo2C ? Math.round(days[k].spo2S / days[k].spo2C) : null);
  const aqiChartData = labels.map(k => days[k].aqiC ? Math.round(days[k].aqiS / days[k].aqiC) : null);
  const eventData = labels.map(k => days[k].ev || 0);

  const shortLabels = labels.map(k => {
    const d = new Date(k + 'T12:00:00');
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  });

  // Summary
  const allBpm = bpmData.filter(v => v !== null);
  const allSpo2 = spo2Data.filter(v => v !== null);
  const allAqi = aqiChartData.filter(v => v !== null);
  document.getElementById('sum-bpm').textContent = allBpm.length ? Math.round(allBpm.reduce((a, b) => a + b) / allBpm.length) : '--';
  document.getElementById('sum-spo2').textContent = allSpo2.length ? Math.round(allSpo2.reduce((a, b) => a + b) / allSpo2.length) : '--';
  document.getElementById('sum-aqi').textContent = allAqi.length ? Math.round(allAqi.reduce((a, b) => a + b) / allAqi.length) : '--';

  // Chart
  if (trendChart) trendChart.destroy();
  const canvas = document.getElementById('trend-chart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  if (readings.length === 0 && events.length === 0) {
    ctx.canvas.parentElement.innerHTML = '<div class="no-data">No data yet.<br>Start logging from the Monitor tab.</div>';
    document.getElementById('events-list').innerHTML = '';
    return;
  }

  trendChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: shortLabels,
      datasets: [
        {
          label: 'BPM',
          data: bpmData,
          borderColor: '#0A84FF',
          backgroundColor: 'rgba(10, 132, 255, 0.08)',
          tension: 0.4,
          borderWidth: 2,
          pointRadius: 3,
          pointHoverRadius: 5,
          yAxisID: 'y'
        },
        {
          label: 'SpO2 %',
          data: spo2Data,
          borderColor: '#30D158',
          backgroundColor: 'rgba(48, 209, 88, 0.08)',
          tension: 0.4,
          borderWidth: 2,
          pointRadius: 3,
          pointHoverRadius: 5,
          yAxisID: 'y1'
        },
        {
          label: 'AQI',
          data: aqiChartData,
          borderColor: '#FF9F0A',
          backgroundColor: 'rgba(255, 159, 10, 0.08)',
          borderDash: [6, 3],
          tension: 0.4,
          borderWidth: 2,
          pointRadius: 3,
          pointHoverRadius: 5,
          yAxisID: 'y'
        },
        {
          label: 'Breathless',
          data: eventData,
          type: 'bar',
          backgroundColor: 'rgba(255, 59, 48, 0.2)',
          borderColor: '#FF3B30',
          borderWidth: 1,
          yAxisID: 'y2',
          barThickness: 4,
          borderRadius: 2
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          labels: {
            font: { family: 'DM Sans', size: 11 },
            color: '#8E8E93',
            boxWidth: 8,
            boxHeight: 8,
            borderRadius: 4,
            useBorderRadius: true,
            padding: 12
          }
        },
        tooltip: {
          backgroundColor: '#1C1C1E',
          titleFont: { family: 'DM Sans', size: 11 },
          bodyFont: { family: 'DM Sans', size: 13 },
          titleColor: '#FFFFFF',
          bodyColor: '#FFFFFF',
          cornerRadius: 10,
          padding: 10
        }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: {
            font: { family: 'DM Sans', size: 10 },
            color: '#8E8E93',
            maxRotation: 45
          }
        },
        y: {
          position: 'left',
          grid: { color: '#F5F5F7' },
          ticks: {
            font: { family: 'DM Sans', size: 10 },
            color: '#8E8E93'
          },
          min: 0
        },
        y1: {
          position: 'right',
          min: 85,
          max: 100,
          grid: { display: false },
          ticks: {
            font: { family: 'DM Sans', size: 10 },
            color: '#30D158'
          }
        },
        y2: {
          display: false,
          min: 0,
          max: 10
        }
      }
    }
  });

  renderEventsList(events, cutoff);
}

function renderEventsList(events, cutoff) {
  const list = document.getElementById('events-list');
  const filtered = events.filter(e => e.ts >= cutoff).sort((a, b) => b.ts - a.ts);

  if (filtered.length === 0) {
    list.innerHTML = '<div class="no-data" style="padding: 16px;">No breathless events in this period.</div>';
    return;
  }

  list.innerHTML = filtered.slice(0, 20).map(e => {
    const time = new Date(e.ts).toLocaleString([], {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
    });
    const status = aqiStatus(e.aqi);
    const aqiClass = status === 'good' ? 'stat-aqi-ok' : status === 'warning' ? 'stat-aqi-warn' : 'stat-aqi-bad';
    return `
      <div class="event-item">
        <span class="event-time">${time}</span>
        <div class="event-stats">
          <span class="stat-bpm">${e.bpm} bpm</span>
          <span class="stat-spo2">${e.spo2}%</span>
          <span class="${aqiClass}">AQI ${e.aqi}</span>
        </div>
      </div>`;
  }).join('');
}

// ── Init ──
function init() {
  applyBpmColor();
  applySpo2Color();
  fetchAqi();
  renderRecentEvents();
  setInterval(fetchAqi, CONFIG.AQI_REFRESH_MS);

  // Init Google Fit after GSI script loads
  if (typeof google !== 'undefined' && google.accounts) {
    initFit();
  } else {
    window.addEventListener('load', () => {
      setTimeout(initFit, 500);
    });
  }

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(err =>
      console.warn('SW registration failed:', err)
    );
  }
}

init();
