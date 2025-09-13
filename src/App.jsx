import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
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

  return (
    <div>
      {/* Simple Header */}
      <div className="header">
        <h1>NavRadar</h1>
        <div className="info">
          {loading && <span>Loading aircraft...</span>}
          {error && <span style={{ color: 'red' }}>Error: {error}</span>}
          {!loading && !error && <span>{aircraft.length} aircraft tracked</span>}
        </div>
      </div>

      {/* Map Container */}
      <div className="map-container">
        <MapContainer
          center={[20, 0]}
          zoom={3}
          minZoom={2}
          maxZoom={12} // Reduced max zoom for better performance
          worldCopyJump={true}
          style={{ height: '100%', width: '100%' }}
          preferCanvas={true}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            updateWhenZooming={false}
            updateWhenIdle={true}
            maxNativeZoom={12} // Match maxZoom for performance
            keepBuffer={2} // Reduce tile buffer
          />
          
          <MapViewport onBoundsChange={(bounds) => fetchAircraftData(bounds)} />

          {/* Optimized Aircraft Markers */}
          {useMemo(() => (
            aircraft.map(({ id, pos, rot, cs, alt, spd }) => (
              <Marker
                key={id}
                position={pos}
                icon={getRotatedIcon(rot)}
              >
                <Popup>
                  <div className="aircraft-popup">
                    <strong>{cs || 'N/A'}</strong>
                    {alt && <div>Alt: {Math.round(alt)}m</div>}
                    {spd && <div>Spd: {Math.round(spd * 3.6)}km/h</div>}
                  </div>
                </Popup>
              </Marker>
            ))
          ), [aircraft])}
        </MapContainer>
      </div>
    </div>
  );
}

export default App;
