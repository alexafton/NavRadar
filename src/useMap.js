import { useEffect, useRef } from 'react';
import L from 'leaflet';

const MAX_ZOOM = 10;

export default function useMap() {
  const mapRef = useRef(null);
  const canvasRef = useRef(null);

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

    const canvas = document.createElement('canvas');
    canvas.style.position = 'absolute';
    canvas.style.top = '0';
    canvas.style.left = '0';
    canvas.style.pointerEvents = 'none';
    const pane = map.getPane('overlayPane');
    pane.appendChild(canvas);
    const initialCtx = canvas.getContext('2d');
    canvasRef.current = { canvas, ctx: initialCtx, pane };
    mapRef.current = map;

    function resizeCanvas() {
      const size = map.getSize();
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.round(size.x * ratio);
      canvas.height = Math.round(size.y * ratio);
      canvas.style.width = size.x + 'px';
      canvas.style.height = size.y + 'px';
      const ctx = canvas.getContext('2d');
      const origin = (map.getPixelOrigin && map.getPixelOrigin()) || { x: 0, y: 0 };
      ctx.setTransform(ratio, 0, 0, ratio, -origin.x * ratio, -origin.y * ratio);
      canvasRef.current = { canvas, ctx, origin, ratio };
    }

    resizeCanvas();
    map.on('resize move zoom', resizeCanvas);

    return () => {
      map.off('resize move zoom', resizeCanvas);
      try { if (pane.contains(canvas)) pane.removeChild(canvas); } catch { /* ignore */ }
      map.remove();
    };
  }, []);

  return { mapRef, canvasRef };
}
