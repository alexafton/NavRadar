import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import axios from 'axios';
import './index.css';

const OPENSKY_API_URL = 'https://opensky-network.org/api/states/all';
const UPDATE_INTERVAL = 10000; // ms
const MAX_ZOOM = 10;

// Draw small rotated triangle on canvas
function drawTriangle(ctx, x, y, heading, color = '#ffbb00') {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate((heading || 0) * Math.PI / 180);
  ctx.beginPath();
  ctx.moveTo(0, -6);
  ctx.lineTo(4, 6);
  ctx.lineTo(-4, 6);
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

    canvasRef.current = { canvas, ctx: canvas.getContext('2d') };
    mapRef.current = map;

    // resize canvas to map size
    function resizeCanvas() {
      const size = map.getSize();
      canvas.width = size.x;
      canvas.height = size.y;
      canvas.style.width = size.x + 'px';
      canvas.style.height = size.y + 'px';
    }

    resizeCanvas();
    map.on('resize move zoom', resizeCanvas);

    return () => {
      map.off('resize move zoom', resizeCanvas);
      try { pane.removeChild(canvas); } catch (e) {}
      map.remove();
      cancelAnimationFrame(rafRef.current);
    };
  }, []);

  // fetch data (rate-limited) and store minimal aircraft list
  const fetchData = async () => {
    const map = mapRef.current;
    if (!map) return;
    const now = Date.now();
    if (now - lastFetchRef.current < UPDATE_INTERVAL) return;
    lastFetchRef.current = now;
    setStatus(s => ({ ...s, loading: true }));

    try {
      const res = await axios.get(OPENSKY_API_URL, { timeout: 5000 });
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
          lat,
          lon,
          hdg: s[10] || 0,
          cs: (s[1] || '').trim(),
          alt: s[7] || null,
          spd: s[9] || null
        });
      }

      aircraftRef.current = next;
      setStatus({ loading: false, error: null, count: next.length });
    } catch (err) {
      console.error(err);
      setStatus({ loading: false, error: 'Fetch failed', count: 0 });
    }
  };

  // draw loop using requestAnimationFrame
  useEffect(() => {
    const map = mapRef.current;
    const c = canvasRef.current;
    if (!map || !c) return;

    function draw() {
      const { canvas, ctx } = c;
      if (!canvas || !ctx) return;

      // clear
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const aircraft = aircraftRef.current;
      if (aircraft.length === 0) {
        rafRef.current = requestAnimationFrame(draw);
        return;
      }

      // map origin for pixel conversion
      const topLeft = map.containerPointToLatLng([0, 0]);
      // iterate and draw
      for (let i = 0; i < aircraft.length; i++) {
        const a = aircraft[i];
        const point = map.latLngToContainerPoint([a.lat, a.lon]);
        drawTriangle(ctx, Math.round(point.x), Math.round(point.y), a.hdg, '#ffbb00');
      }

      rafRef.current = requestAnimationFrame(draw);
    }

    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  }, [/* intentionally empty - references inside refs */]);

  // polling and map move handlers
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const onMove = () => {
      // fetch quickly on move end, but not too often
      fetchData();
    };

    map.on('moveend zoomend', onMove);
    // initial
    fetchData();
    const interval = setInterval(fetchData, UPDATE_INTERVAL);

    return () => {
      clearInterval(interval);
      map.off('moveend zoomend', onMove);
    };
  }, []);

  return (
    <div>
      <div className="header">
        <h1>NavRadar</h1>
        <div className="info">
          {status.loading && <span>Loading aircraft...</span>}
          {status.error && <span style={{ color: 'red' }}>Error: {status.error}</span>}
          {!status.loading && !status.error && <span>{status.count} aircraft in view</span>}
        </div>
      </div>
      <div id="map" className="map-container" />
    </div>
  );
}
