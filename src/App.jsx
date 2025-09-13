import React, { useEffect, useRef, useState, useCallback } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import axios from 'axios';
import './index.css';

const OPENSKY_API_URL = 'https://opensky-network.org/api/states/all';
const UPDATE_INTERVAL = 10000; // ms
const MAX_ZOOM = 10;

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
    } catch (e) {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    const payload = { detail, heatmapOn, useProxy };
    try { localStorage.setItem('navradar_settings', JSON.stringify(payload)); } catch (e) {}
  }, [detail, heatmapOn, useProxy]);

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

  // create canvas and attach to overlayPane
    const canvas = document.createElement('canvas');
    canvas.style.position = 'absolute';
    canvas.style.top = '0';
    canvas.style.left = '0';
    canvas.style.pointerEvents = 'none'; // allow map interaction
    const pane = map.getPane('overlayPane');
    pane.appendChild(canvas);
  // initialize with devicePixelRatio aware sizing in resizeCanvas
  const initialCtx = canvas.getContext('2d');
  canvasRef.current = { canvas, ctx: initialCtx };
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
      // set transform so drawing is in CSS pixels
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      canvasRef.current = { canvas, ctx };
    }

    resizeCanvas();
    map.on('resize move zoom', resizeCanvas);

    return () => {
      map.off('resize move zoom', resizeCanvas);
      if (pane.contains(canvas)) pane.removeChild(canvas);
      map.remove();
      cancelAnimationFrame(rafRef.current);
    };
  }, []);

  // fetch data (rate-limited) and store minimal aircraft list
  const fetchData = useCallback(async () => {
    const map = mapRef.current;
    if (!map) return;
    const now = Date.now();
    if (now - lastFetchRef.current < UPDATE_INTERVAL) return;
    lastFetchRef.current = now;
    setStatus(s => ({ ...s, loading: true }));

    try {
      const url = useProxy ? '/api/opensky' : OPENSKY_API_URL;
      const res = await axios.get(url, { timeout: 5000 });
      const states = res.data?.states || [];
      const bounds = map.getBounds();
      const next = [];
      for (let i = 0; i < states.length; i++) {
        const s = states[i];
        const lon = s[5];
        const lat = s[6];
        if (lat == null || lon == null) continue;
        if (!bounds.contains([lat, lon])) continue;
        // include richer fields; destination not available from OpenSky states
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

      // Progressive downsampling when there are too many aircraft in view
      let sampled = next;
      // MAX_IN_VIEW may be reduced by autoScaleRef when device is struggling
      const BASE_MAX = 3000;
      const MAX_IN_VIEW = Math.max(200, Math.floor(BASE_MAX / autoScaleRef.current));
      if (next.length > MAX_IN_VIEW) {
        const factor = Math.ceil(next.length / MAX_IN_VIEW);
        sampled = next.filter((_, idx) => idx % factor === 0);
        console.info(`Downsampled ${next.length} -> ${sampled.length} (factor ${factor})`);
      }

      aircraftRef.current = sampled;
      setStatus({ loading: false, error: null, count: next.length });
    } catch (err) {
      console.error(err);
      setStatus({ loading: false, error: 'Fetch failed', count: 0 });
    }
  }, [useProxy]);

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
        const point = map.latLngToContainerPoint([a.lat, a.lon]);
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

      for (const [, cell] of cells) {
        // color by density for icon
        let color = '#0f62fe';
        if (cell.count > 20) color = '#ff4d4f';
        else if (cell.count > 5) color = '#ffba08';
        drawPlane(ctx, cell.x, cell.y, cell.rep.hdg || 0, color);
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

    // click handler: find nearest aircraft and show popup
    const onClick = (ev) => {
      const aircraft = aircraftRef.current;
      if (!aircraft || aircraft.length === 0) return;
      const clickPoint = map.latLngToContainerPoint(ev.latlng);
      let best = null;
      let bestDist = Infinity;
      for (let i = 0; i < aircraft.length; i++) {
        const a = aircraft[i];
        const p = map.latLngToContainerPoint([a.lat, a.lon]);
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
        <div className="controls">
          <label>Detail:</label>
          <button className={detail === 'auto' ? 'active' : ''} onClick={() => setDetail('auto')}>Auto</button>
          <button className={detail === 'high' ? 'active' : ''} onClick={() => setDetail('high')}>High</button>
          <button className={detail === 'low' ? 'active' : ''} onClick={() => setDetail('low')}>Low</button>
          <label style={{ marginLeft: 12 }}>Heatmap</label>
          <button className={heatmapOn ? 'active' : ''} onClick={() => setHeatmapOn(h => !h)}>{heatmapOn ? 'On' : 'Off'}</button>
          <label style={{ marginLeft: 12 }}>Proxy</label>
          <button className={useProxy ? 'active' : ''} onClick={() => setUseProxy(p => !p)}>{useProxy ? 'On' : 'Off'}</button>
          <div style={{ marginLeft: 12, color: '#cfe3ff' }}>FPS: {fps}</div>
        </div>
      </div>
      <div id="map" className="map-container" />
    </div>
  );
}
