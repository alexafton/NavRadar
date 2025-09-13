import React, { useEffect, useRef, useState, useCallback } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import axios from 'axios';
import './index.css';

const OPENSKY_API_URL = 'https://opensky-network.org/api/states/all';
const UPDATE_INTERVAL = 10000; // ms
const MAX_ZOOM = 10;

// small in-memory cache for generated plane sprites
const planeImgCache = new Map();

// create an image element from a tiny SVG that resembles a plane icon
function createPlaneImage(size) {
  // Slightly more accurate plane silhouette (open-source inspired)
  const scale = size / 24;
  const svg = `<?xml version="1.0" encoding="UTF-8"?><svg xmlns='http://www.w3.org/2000/svg' width='${size}' height='${size}' viewBox='0 0 24 24'><g transform='scale(${scale})' fill='none' stroke='none'><path d='M12 1c0 0-1.5 4-2 5-1 .5-5 2-5 2s4 1 5 1c.5 0 2 4 2 4s0-4 .5-5c.8-1.2 3.5-1.2 3.5-1.2s-2.8-.5-4-1.5c-.6-.5-1.5-3-1.5-3z' fill='#ffbb00' stroke='#222' stroke-width='0.3'/></g></svg>`;
  const img = new Image();
  img.src = 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
  return img;
}

// Draw a small plane-like triangle (slightly stylized)
function drawPlane(ctx, x, y, heading, color = '#ffbb00') {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate((heading || 0) * Math.PI / 180);
  ctx.beginPath();
  ctx.moveTo(0, -7);
  ctx.lineTo(6, 8);
  ctx.lineTo(2, 6);
  ctx.lineTo(-2, 6);
  ctx.lineTo(-6, 8);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();
}

export default function App() {
  const mapRef = useRef(null);
  const canvasRef = useRef(null);
  const aircraftRef = useRef([]); // holds minimal aircraft objects
  const lastFetchRef = useRef(0);
  const rafRef = useRef(null);
  const [status, setStatus] = useState({ loading: false, error: null, count: 0 });
  const [detail, setDetail] = useState('auto'); // 'auto' | 'high' | 'low'
  const [heatmapOn, setHeatmapOn] = useState(false);
  const [useProxy, setUseProxy] = useState(false);
  const [fps, setFps] = useState(0);
  const autoScaleRef = useRef(1); // multiplier applied to MAX_IN_VIEW and grid size when autotuning

  // load/save simple UI settings
  useEffect(() => {
    try {
      const raw = localStorage.getItem('navradar_settings');
      if (raw) {
        const s = JSON.parse(raw);
        if (s.detail) setDetail(s.detail);
        if (typeof s.heatmapOn === 'boolean') setHeatmapOn(s.heatmapOn);
        if (typeof s.useProxy === 'boolean') setUseProxy(s.useProxy);
      }
    } catch {
      // ignore parse errors
    }
  }, []);

  useEffect(() => {
    const payload = { detail, heatmapOn, useProxy };
    try { localStorage.setItem('navradar_settings', JSON.stringify(payload)); } catch { /* ignore */ }
  }, [detail, heatmapOn, useProxy]);

  const [settingsOpen, setSettingsOpen] = useState(false);

  // init map + canvas overlay
  useEffect(() => {
    const map = L.map('map', {
      center: [20, 0],
      zoom: 3,
      minZoom: 2,
      maxZoom: MAX_ZOOM,
      worldCopyJump: true,
      preferCanvas: true
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: MAX_ZOOM,
      maxNativeZoom: MAX_ZOOM,
      updateWhenIdle: true,
      updateWhenZooming: false,
      keepBuffer: 1
    }).addTo(map);

  // create canvas and attach to overlayPane; we'll draw using layer coordinates
  const canvas = document.createElement('canvas');
  canvas.style.position = 'absolute';
  canvas.style.top = '0';
  canvas.style.left = '0';
  canvas.style.pointerEvents = 'none'; // allow map interaction
  const pane = map.getPane('overlayPane');
  pane.appendChild(canvas);
  // initialize with devicePixelRatio aware sizing in resizeCanvas
  const initialCtx = canvas.getContext('2d');
  canvasRef.current = { canvas, ctx: initialCtx, pane };
    mapRef.current = map;

    // resize canvas to map size
    function resizeCanvas() {
      const size = map.getSize();
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.round(size.x * ratio);
      canvas.height = Math.round(size.y * ratio);
      canvas.style.width = size.x + 'px';
      canvas.style.height = size.y + 'px';
      const ctx = canvas.getContext('2d');
      // account for map pixel origin so layer coordinates map to canvas pixels
      const origin = (map.getPixelOrigin && map.getPixelOrigin()) || { x: 0, y: 0 };
      // transform: scale for DPR and translate by -origin
      ctx.setTransform(ratio, 0, 0, ratio, -origin.x * ratio, -origin.y * ratio);
      canvasRef.current = { canvas, ctx, origin, ratio };
    }

    resizeCanvas();
    map.on('resize move zoom', resizeCanvas);

    return () => {
      map.off('resize move zoom', resizeCanvas);
      try { if (pane.contains(canvas)) pane.removeChild(canvas); } catch { /* ignore */ }
      map.remove();
      cancelAnimationFrame(rafRef.current);
    };
  }, []);

  // fetch data (rate-limited) and store minimal aircraft list
  // robust fetch with retry and optional proxy fallback
  const fetchData = useCallback(async () => {
    const map = mapRef.current;
    if (!map) return;
    const now = Date.now();
    if (now - lastFetchRef.current < UPDATE_INTERVAL) return;
    lastFetchRef.current = now;
    setStatus(s => ({ ...s, loading: true }));

    // helper to parse response into aircraft array
    const parseStates = (res) => {
      const states = res.data?.states || [];
      const bounds = map.getBounds();
      const next = [];
      for (let i = 0; i < states.length; i++) {
        const s = states[i];
        const lon = s[5];
        const lat = s[6];
        if (lat == null || lon == null) continue;
        if (!bounds.contains([lat, lon])) continue;
        next.push({
          id: s[0],
          cs: (s[1] || '').trim() || 'N/A',
          origin_country: s[2] || 'N/A',
          lat,
          lon,
          hdg: s[10] || 0,
          alt_baro: s[7] || null,
          alt_geo: s[13] || null,
          spd: s[9] || null,
          last_contact: s[4] || null
        });
      }
      return next;
    };

    // very short in-memory cache to reduce visible failures
    if (!fetchData._cache) fetchData._cache = { ts: 0, data: null };
    const CACHE_TTL = 5000; // ms
    let res = null;
    const tryFetch = async (url, timeout) => {
      const r = await axios.get(url, { timeout });
      return r;
    };

    // try direct with exponential backoff, then proxy fallback
    const maxAttempts = 3;
    let attempt = 0;
    while (attempt < maxAttempts) {
      attempt++;
      try {
        res = await tryFetch(OPENSKY_API_URL, 4000 + attempt * 1000);
        break;
      } catch {
        // wait a bit before retrying
        const backoff = 200 * Math.pow(2, attempt);
        await new Promise(r => setTimeout(r, backoff));
      }
    }

    if (!res) {
      // try proxy once before giving up
      try {
        res = await tryFetch('/api/opensky', 8000);
      } catch {
        // last chance: return cached data if still recent
        if (fetchData._cache.data && (Date.now() - fetchData._cache.ts < CACHE_TTL)) {
          const cachedNext = fetchData._cache.data;
          aircraftRef.current = cachedNext;
          setStatus({ loading: false, error: null, count: cachedNext.length });
          return;
        }
        setStatus({ loading: false, error: 'Fetch failed', count: 0 });
        return;
      }
    }

    try {
      const next = parseStates(res);

      // Progressive downsampling when there are too many aircraft in view
      let sampled = next;
      const BASE_MAX = 3000;
      const MAX_IN_VIEW = Math.max(200, Math.floor(BASE_MAX / autoScaleRef.current));
      if (next.length > MAX_IN_VIEW) {
        const factor = Math.ceil(next.length / MAX_IN_VIEW);
        sampled = next.filter((_, idx) => idx % factor === 0);
        console.info(`Downsampled ${next.length} -> ${sampled.length} (factor ${factor})`);
      }

  aircraftRef.current = sampled;
  // populate cache
  fetchData._cache = { ts: Date.now(), data: sampled };
  setStatus({ loading: false, error: null, count: next.length });
    } catch (err) {
      console.error('Parsing/fill failed', err && err.message);
      setStatus({ loading: false, error: 'Fetch failed', count: 0 });
    }
  }, []);

  // draw loop using requestAnimationFrame
  useEffect(() => {
    const map = mapRef.current;
    const c = canvasRef.current;
    if (!map || !c) return;

    let lastFrame = performance.now();
    let fpsSamples = [];

    function draw() {
      const { canvas, ctx } = c;
      if (!canvas || !ctx) return;

      // clear (in CSS pixels)
      const size = map.getSize();
      ctx.clearRect(0, 0, size.x, size.y);

      const aircraft = aircraftRef.current;
      if (!aircraft || aircraft.length === 0) {
        rafRef.current = requestAnimationFrame(draw);
        return;
      }

      // aggregation size depends on zoom and detail setting
      const zoom = map.getZoom();
      let gridSize = Math.max(8, Math.floor(48 / Math.max(1, zoom)));
      if (detail === 'low') gridSize *= 2;
      if (detail === 'high') gridSize = Math.max(4, Math.floor(gridSize / 2));
      const cells = new Map();

      for (let i = 0; i < aircraft.length; i++) {
        const a = aircraft[i];
        // use layer point so coords remain stable during zoom/transform
        const point = map.latLngToLayerPoint([a.lat, a.lon]);
        const x = Math.round(point.x);
        const y = Math.round(point.y);
        if (x < -50 || y < -50 || x > size.x + 50 || y > size.y + 50) continue;
        const key = `${Math.floor(x / gridSize)}_${Math.floor(y / gridSize)}`;
        if (!cells.has(key)) cells.set(key, { x, y, rep: a, count: 0 });
        const cell = cells.get(key);
        cell.count++;
      }

      // optional heatmap: draw semi-transparent additive circles per cell before icons
      if (heatmapOn) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        for (const [, cell] of cells) {
          const intensity = Math.min(1, cell.count / 15);
          const grd = ctx.createRadialGradient(cell.x, cell.y, 0, cell.x, cell.y, Math.max(24, gridSize * 1.5));
          grd.addColorStop(0, `rgba(255,80,80,${0.18 * intensity})`);
          grd.addColorStop(1, 'rgba(255,80,80,0)');
          ctx.fillStyle = grd;
          ctx.beginPath();
          ctx.arc(cell.x, cell.y, Math.max(24, gridSize * 1.5), 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }

  // draw sprites if loaded, otherwise fallback to drawPlane
      for (const [, cell] of cells) {
        const zoomForSize = Math.max(1, map.getZoom());
        const size = Math.max(12, Math.min(44, 10 + zoomForSize * 3));
        const key = `${size}`;
        let img = planeImgCache.get(key);
        if (!img) {
          img = createPlaneImage(size);
          planeImgCache.set(key, img);
        }

        if (img && img.complete) {
          ctx.save();
          ctx.translate(cell.x, cell.y);
          ctx.rotate((cell.rep.hdg || 0) * Math.PI / 180);
          ctx.drawImage(img, -size / 2, -size / 2, size, size);
          ctx.restore();
        } else {
          // fallback colored triangle
          let color = '#0f62fe';
          if (cell.count > 20) color = '#ff4d4f';
          else if (cell.count > 5) color = '#ffba08';
          drawPlane(ctx, cell.x, cell.y, cell.rep.hdg || 0, color);
        }

        if (cell.count > 1) {
          ctx.fillStyle = 'rgba(0,0,0,0.7)';
          ctx.font = '12px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(String(cell.count), cell.x, cell.y + 16);
        }
      }

      // FPS measurement and autotune
      const now = performance.now();
      const delta = now - lastFrame;
      lastFrame = now;
      const currentFps = 1000 / delta;
      fpsSamples.push(currentFps);
      if (fpsSamples.length > 30) fpsSamples.shift();
      const avg = fpsSamples.reduce((a, b) => a + b, 0) / fpsSamples.length;
      setFps(Math.round(avg));
      // autotune adjustments when in 'auto' mode: if avg fps < 22 increase autoScale, if > 35 decrease
      if (detail === 'auto') {
        if (avg < 22) {
          autoScaleRef.current = Math.min(8, autoScaleRef.current * 1.25);
        } else if (avg > 35) {
          autoScaleRef.current = Math.max(1, autoScaleRef.current * 0.85);
        }
      } else {
        autoScaleRef.current = 1;
      }

      rafRef.current = requestAnimationFrame(draw);
    }

    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  }, [detail, heatmapOn]);

  // polling and map move handlers
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const onMove = () => {
      // fetch quickly on move end, but not too often
      fetchData();
    };

    // click handler: find nearest aircraft and show popup (use layer points)
    const onClick = (ev) => {
      const aircraft = aircraftRef.current;
      if (!aircraft || aircraft.length === 0) return;
      const clickPoint = ev.layerPoint || map.latLngToLayerPoint(ev.latlng);
      let best = null;
      let bestDist = Infinity;
      for (let i = 0; i < aircraft.length; i++) {
        const a = aircraft[i];
        const p = map.latLngToLayerPoint([a.lat, a.lon]);
        const dx = p.x - clickPoint.x;
        const dy = p.y - clickPoint.y;
        const d = dx*dx + dy*dy;
        if (d < bestDist) { bestDist = d; best = a; }
      }
      // threshold in pixels (~20px)
      if (best && bestDist <= 400) {
        const html = `<div class="aircraft-popup"><strong>${best.cs || 'N/A'}</strong><div>Origin: ${best.origin_country || 'N/A'}</div>${best.alt_baro ? `<div>Alt: ${Math.round(best.alt_baro)} m</div>` : ''}${best.spd ? `<div>Spd: ${Math.round(best.spd*3.6)} km/h</div>` : ''}</div>`;
        L.popup({ closeButton: true, maxWidth: 240 })
          .setLatLng([best.lat, best.lon])
          .setContent(html)
          .openOn(map);
      }
    };

  map.on('click', onClick);

  map.on('moveend zoomend', onMove);
  // initial
  fetchData();
  const interval = setInterval(fetchData, UPDATE_INTERVAL);

    return () => {
      clearInterval(interval);
      map.off('moveend zoomend', onMove);
      map.off('click', onClick);
    };
  }, [fetchData]);

  return (
    <div>
      <div className="header">
        <h1>NavRadar</h1>
        <div className="info">
          {status.loading && <span>Loading aircraft...</span>}
          {status.error && <span style={{ color: 'red' }}>Error: {status.error}</span>}
          {!status.loading && !status.error && <span>{status.count} aircraft in view</span>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button className="settings-toggle" onClick={() => setSettingsOpen(s => !s)}>⚙</button>
          <div style={{ color: '#cfe3ff' }}>FPS: {fps}</div>
        </div>
      </div>
      {settingsOpen && (
        <div className="settings-panel">
          <div className="settings-row">
            <label>Detail</label>
            <select value={detail} onChange={(e) => setDetail(e.target.value)}>
              <option value="auto">Auto</option>
              <option value="high">High</option>
              <option value="low">Low</option>
            </select>
          </div>
          <div className="settings-row">
            <label>Heatmap</label>
            <input type="checkbox" checked={heatmapOn} onChange={(e) => setHeatmapOn(e.target.checked)} />
          </div>
          <div className="settings-row">
            <label>Use Proxy</label>
            <input type="checkbox" checked={useProxy} onChange={(e) => setUseProxy(e.target.checked)} />
          </div>
          <div className="settings-row">
            <button onClick={() => { autoScaleRef.current = 1; }}>Reset Autotune</button>
          </div>
        </div>
      )}
      <div id="map" className="map-container" />
    </div>
  );
}
