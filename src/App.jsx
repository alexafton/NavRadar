import// --- Configuration ---
const OPENSKY_API_URL = 'https://opensky-network.org/api/states/all';
const BOUNDS_PADDING = 0.5; // degrees
const UPDATE_INTERVAL = 10000; // 10 seconds
const MAX_ZOOM = 10; // Reduce max zoom for better performance

// Canvas utilities for aircraft rendering
const drawAircraft = (ctx, x, y, heading, selected = false) => {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate((heading || 0) * Math.PI / 180);
  
  // Draw aircraft triangle
  ctx.beginPath();
  ctx.moveTo(0, -6);
  ctx.lineTo(4, 6);
  ctx.lineTo(-4, 6);
  ctx.closePath();
  
  // Fill and stroke
  ctx.fillStyle = selected ? '#ff9900' : '#ffbb00';
  ctx.fill();
  ctx.restore();
}; useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import axios from 'axios';
import './index.css';

// --- Configuration ---
const OPENSKY_API_URL = 'https://opensky-network.org/api/states/all';
const BOUNDS_PADDING = 0.5; // degrees

// Custom hook for viewport state
function useViewport() {
  const map = useMap();
  const [bounds, setBounds] = useState(map.getBounds());
  
  useEffect(() => {
    const updateBounds = () => {
      setBounds(map.getBounds());
    };
    
    map.on('moveend', updateBounds);
    return () => map.off('moveend', updateBounds);
  }, [map]);
  
  return bounds;
}

// --- Aircraft Icon ---
// Simplified aircraft icon cache
const iconCache = {};
const getRotatedIcon = (heading) => {
  const roundedHeading = Math.round(heading || 0);
  if (!iconCache[roundedHeading]) {
    iconCache[roundedHeading] = new L.DivIcon({
      className: 'aircraft-marker',
      iconSize: [8, 8],
      iconAnchor: [4, 4],
      popupAnchor: [0, -8],
      html: `<div style="transform: rotate(${roundedHeading}deg);"></div>`
    });
  }
  return iconCache[roundedHeading];
};

// --- Main App Component ---
function App() {
  const [aircraft, setAircraft] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Map viewport component
  const MapViewport = ({ onBoundsChange }) => {
    const bounds = useViewport();
    
    useEffect(() => {
      onBoundsChange(bounds);
    }, [bounds, onBoundsChange]);
    
    return null;
  };

  // Optimized data fetching with viewport filtering
  const fetchAircraftData = useCallback(async (bounds) => {
    if (!bounds) return;
    
    setLoading(true);
    setError(null);
    try {
      const response = await axios.get(OPENSKY_API_URL);
      
      if (response.data?.states?.length > 0) {
        // Filter aircraft within viewport + padding
        const [south, west] = [
          bounds.getSouth() - BOUNDS_PADDING,
          bounds.getWest() - BOUNDS_PADDING
        ];
        const [north, east] = [
          bounds.getNorth() + BOUNDS_PADDING,
          bounds.getEast() + BOUNDS_PADDING
        ];

        const processedAircraft = response.data.states.reduce((acc, state) => {
          const lat = state[6];
          const lon = state[5];
          
          if (lat !== null && lon !== null &&
              lat >= south && lat <= north &&
              lon >= west && lon <= east) {
            acc.push({
              id: state[0], // icao24
              pos: [lat, lon],
              rot: state[10] || 0, // heading
              alt: state[7], // altitude for popup
              spd: state[9], // velocity for popup
              cs: state[1]?.trim() // callsign for popup
            });
          }
          return acc;
        }, []);

        setAircraft(processedAircraft);
      }
    } catch (err) {
      setError(err.response?.statusText || "Network error");
      console.error("Error:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch data on component mount and set up interval
  useEffect(() => {
    fetchAircraftData(); // Initial fetch

    // Set up interval to fetch data every 15 seconds
    const intervalId = setInterval(fetchAircraftData, 15000);

    // Clean up interval on component unmount
    return () => clearInterval(intervalId);
  }, [fetchAircraftData]); // Add fetchAircraftData to dependencies

  // Set up update interval
  useEffect(() => {
    // Initial update
    updateAircraft();
    
    // Set up periodic updates
    const intervalId = setInterval(updateAircraft, UPDATE_INTERVAL);
    
    // Set up map event handlers
    const map = mapRef.current;
    if (map) {
      const debouncedUpdate = () => {
        const now = Date.now();
        if (now - lastFetchRef.current >= UPDATE_INTERVAL / 2) {
          updateAircraft();
        }
      };
      
      map.on('moveend', debouncedUpdate);
      map.on('zoomend', debouncedUpdate);
      
      return () => {
        clearInterval(intervalId);
        map.off('moveend', debouncedUpdate);
        map.off('zoomend', debouncedUpdate);
      };
    }
  }, []);

  return (
    <div>
      <div className="header">
        <h1>NavRadar</h1>
        <div className="info">
          {status.loading && <span>Loading aircraft...</span>}
          {status.error && <span style={{ color: 'red' }}>Error: {status.error}</span>}
          {!status.loading && !status.error && <span>{status.count} aircraft tracked</span>}
        </div>
      </div>
      <div id="map" style={{ height: 'calc(100vh - 50px)', width: '100%' }} />
    </div>
  );
}

export default App;
