import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import axios from 'axios';
import './index.css';

// Config
const OPENSKY_API_URL = 'https://opensky-network.org/api/states/all';
const UPDATE_INTERVAL = 10000; // ms
const MAX_ZOOM = 10;

// Minimal marker styling via DivIcon (triangle-ish via clip-path in CSS)
function createMarker(latlng, heading, popupHtml) {
  const icon = L.divIcon({
    className: 'aircraft-marker',
    iconSize: [8, 8]
  });
  const marker = L.marker(latlng, { icon, rotationAngle: heading || 0, rotationOrigin: 'center center' });
  if (popupHtml) marker.bindPopup(popupHtml, { closeButton: false });
  return marker;
}

export default function App() {
  const mapRef = useRef(null);
  const layerRef = useRef(null);
  const lastFetchRef = useRef(0);
  const [status, setStatus] = useState({ loading: false, error: null, count: 0 });

  // Initialize map once
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

    const layer = L.layerGroup().addTo(map);

    mapRef.current = map;
    layerRef.current = layer;

    return () => {
      try { map.remove(); } catch (e) { /* ignore */ }
    };
  }, []);

  // Fetch aircraft within current bounds
  const fetchAndRender = async () => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;

    const now = Date.now();
    if (now - lastFetchRef.current < UPDATE_INTERVAL) return; // rate limit
    lastFetchRef.current = now;

    setStatus(s => ({ ...s, loading: true }));

    try {
      const bounds = map.getBounds();
      const res = await axios.get(OPENSKY_API_URL);
      const states = res.data?.states || [];

      // Clear previous markers in the layer (fast)
      layer.clearLayers();

      // Filter and add markers
      let count = 0;
      for (let i = 0; i < states.length; i++) {
        const st = states[i];
        const lon = st[5];
        const lat = st[6];
        if (lat == null || lon == null) continue;
        if (!bounds.contains([lat, lon])) continue; // skip outside viewport

        const heading = st[10] || 0;
        const callsign = (st[1] || '').trim() || 'N/A';
        const alt = st[7];
        const spd = st[9];

        const popup = `<div class="aircraft-popup"><strong>${callsign}</strong>${alt ? `<div>Alt: ${Math.round(alt)} m</div>` : ''}${spd ? `<div>Spd: ${Math.round(spd*3.6)} km/h</div>` : ''}</div>`;
        const m = createMarker([lat, lon], heading, popup);
        m.addTo(layer);
        count++;
      }

      setStatus({ loading: false, error: null, count });
    } catch (err) {
      console.error('Fetch error', err);
      setStatus({ loading: false, error: 'Failed to fetch data', count: 0 });
    }
  };

  // Setup interval and map events
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Initial fetch
    fetchAndRender();

    const onMove = () => fetchAndRender();
    map.on('moveend', onMove);
    map.on('zoomend', onMove);

    const interval = setInterval(fetchAndRender, UPDATE_INTERVAL);
    return () => {
      clearInterval(interval);
      if (map) { map.off('moveend', onMove); map.off('zoomend', onMove); }
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
