// ── State ──
let bpm = 72;
let spo2 = 98;
let aqi = null;
let aqiLabel = '';
let aqiData = null;
let saveTimer = null;
let currentRange = 7;
let trendChart = null;

// ── Storage Helpers ──
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

// ── Number Pop Animation ──
function popValue(el) {
  el.classList.add('pop');
  setTimeout(() => el.classList.remove('pop'), 120);
}

// ── BPM Controls ──
function adjustBpm(delta) {
  bpm = Math.max(40, Math.min(200, bpm + delta));
  const el = document.getElementById('bpm-value');
  el.textContent = bpm;
  popValue(el);
  applyBpmColor();
  scheduleSave();
}

function applyBpmColor() {
  const el = document.getElementById('bpm-value');
  el.classList.remove('status-good', 'status-warning', 'status-danger', 'status-neutral');
  if (bpm > 120) {
    el.classList.add('status-danger');
  } else if (bpm < 60 || bpm > 100) {
    el.classList.add('status-warning');
  } else {
    el.classList.add('status-good');
  }
}

// ── SpO2 Controls ──
function adjustSpo2(delta) {
  spo2 = Math.max(70, Math.min(100, spo2 + delta));
  const el = document.getElementById('spo2-value');
  el.textContent = spo2;
  popValue(el);
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

// ── Auto-save 3s after last change ──
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveReading({
      ts: Date.now(),
      bpm,
      spo2,
      aqi: aqi || 0,
      aqiLabel: aqiLabel || 'Unknown'
    });
  }, 3000);
}

// ── AQI Helpers ──
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

async function fetchAqi() {
  const cached = localStorage.getItem('breathe_aqi_cache');
  if (cached) {
    const { data, ts } = JSON.parse(cached);
    if (Date.now() - ts < 15 * 60 * 1000) {
      applyAqi(data);
      return;
    }
  }

  try {
    const pos = await new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: false,
        timeout: 10000
      });
    });

    const { latitude: lat, longitude: lng } = pos.coords;
    const res = await fetch(
      `https://api.ambeedata.com/latest/by-lat-lng?lat=${lat}&lng=${lng}`,
      { headers: { 'x-api-key': CONFIG.AMBEE_API_KEY, 'Content-type': 'application/json' } }
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
    pill.textContent = 'Unavailable';
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

  document.getElementById('last-aqi-time').textContent = `AQI ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  updateStatus('live', 'AQI live');
}

function updateStatus(state, text) {
  const dot = document.getElementById('status-dot');
  const label = document.getElementById('status-text');
  label.textContent = text;
  dot.style.background = state === 'live' ? 'var(--good)' : state === 'error' ? 'var(--danger)' : 'var(--text-muted)';
}

// ── Breathless Button ──
function logBreathless() {
  if (navigator.vibrate) navigator.vibrate([100, 50, 100]);

  const btn = document.getElementById('breathless-btn');
  btn.classList.add('pressed');
  setTimeout(() => btn.classList.remove('pressed'), 600);

  const confirm = document.getElementById('breathless-confirm');
  const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  confirm.textContent = `Logged ${time}`;
  confirm.classList.add('show');
  setTimeout(() => confirm.classList.remove('show'), 2000);

  saveEvent({
    ts: Date.now(),
    bpm,
    spo2,
    aqi: aqi || 0,
    aqiLabel: aqiLabel || 'Unknown'
  });
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
  const cutoff = now - currentRange * 24 * 60 * 60 * 1000;

  const days = {};
  for (let i = 0; i < currentRange; i++) {
    const d = new Date(now - i * 86400000);
    const key = d.toISOString().slice(0, 10);
    days[key] = { bpmSum: 0, bpmCount: 0, spo2Sum: 0, spo2Count: 0, aqiSum: 0, aqiCount: 0, events: 0 };
  }

  readings.filter(r => r.ts >= cutoff).forEach(r => {
    const key = new Date(r.ts).toISOString().slice(0, 10);
    if (days[key]) {
      days[key].bpmSum += r.bpm;
      days[key].bpmCount++;
      days[key].spo2Sum += r.spo2;
      days[key].spo2Count++;
      if (r.aqi) {
        days[key].aqiSum += r.aqi;
        days[key].aqiCount++;
      }
    }
  });

  events.filter(e => e.ts >= cutoff).forEach(e => {
    const key = new Date(e.ts).toISOString().slice(0, 10);
    if (days[key]) days[key].events++;
  });

  const labels = Object.keys(days).sort();
  const bpmData = labels.map(k => days[k].bpmCount ? Math.round(days[k].bpmSum / days[k].bpmCount) : null);
  const spo2Data = labels.map(k => days[k].spo2Count ? Math.round(days[k].spo2Sum / days[k].spo2Count) : null);
  const aqiChartData = labels.map(k => days[k].aqiCount ? Math.round(days[k].aqiSum / days[k].aqiCount) : null);
  const eventData = labels.map(k => days[k].events || 0);

  const shortLabels = labels.map(k => {
    const d = new Date(k + 'T12:00:00');
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  });

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
          borderColor: 'var(--chart-bpm)',
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
          borderColor: 'var(--chart-spo2)',
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
          borderColor: 'var(--chart-aqi)',
          backgroundColor: 'rgba(255, 159, 10, 0.08)',
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
          borderColor: 'var(--chart-event)',
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
    const aqiStat = aqiStatus(e.aqi);
    const aqiClass = aqiStat === 'good' ? 'stat-aqi-ok' : aqiStat === 'warning' ? 'stat-aqi-warn' : 'stat-aqi-bad';
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
  setInterval(fetchAqi, 15 * 60 * 1000);

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(err =>
      console.warn('SW registration failed:', err)
    );
  }
}

init();
