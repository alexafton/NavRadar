import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import axios from 'axios';
import './index.css'; // Import your CSS

// --- Configuration ---
const OPENSKY_API_URL = 'https://opensky-network.org/api/states/all';

// --- Aircraft Icon ---
// Create aircraft icon with rotation support
const getRotatedIcon = (heading) => {
  const validHeading = heading !== null && heading !== undefined && !isNaN(heading) ? heading : 0;
  
  return new L.DivIcon({
    className: 'aircraft-marker',
    iconSize: [16, 16],
    iconAnchor: [8, 8],
    popupAnchor: [0, -16],
    html: `<div style="transform: rotate(${validHeading}deg);"></div>`
  });
};

// --- Main App Component ---
function App() {
  const [aircraft, setAircraft] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Optimized function to fetch aircraft data
  const fetchAircraftData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await axios.get(OPENSKY_API_URL);
      
      if (response.data?.states?.length > 0) {
        const processedAircraft = response.data.states
          .reduce((acc, state) => {
            if (state[5] !== null && state[6] !== null) { // Check for valid coordinates
              acc.push({
                icao24: state[0],
                callsign: state[1]?.trim() || 'N/A',
                origin_country: state[2],
                longitude: state[5],
                latitude: state[6],
                baro_altitude: state[7],
                on_ground: state[8],
                velocity: state[9],
                heading: state[10],
                vertical_rate: state[11]
              });
            }
            return acc;
          }, []);

        setAircraft(processedAircraft);
      } else {
        setError("No aircraft data available.");
      }
    } catch (err) {
      const errorMessage = err.response 
        ? `API Error (${err.response.status}): ${err.response.statusText}`
        : err.request 
          ? "Network Error: No response received from OpenSky API."
          : `Request Error: ${err.message}`;
      setError(errorMessage);
      console.error("Error fetching aircraft data:", err);
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
          zoom={2}
          minZoom={2}
          maxZoom={18}
          worldCopyJump={true}
          style={{ height: '100%', width: '100%' }}
          preferCanvas={true} // Use Canvas renderer for better performance
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            updateWhenZooming={false} // Improve performance during zoom
            updateWhenIdle={true}
          />

          {/* Aircraft Markers - Using useMemo to prevent unnecessary re-renders */}
          {useMemo(() => (
            aircraft.map((ac) => {
              const position = [ac.latitude, ac.longitude];
              const icon = getRotatedIcon(ac.heading);

              return (
                <Marker
                  key={ac.icao24}
                  position={position}
                  icon={icon}
                >
                  <Popup>
                    <h3>{ac.callsign}</h3>
                    <p><strong>ICAO:</strong> {ac.icao24}</p>
                    <p><strong>Country:</strong> {ac.origin_country}</p>
                    {ac.baro_altitude && (
                      <p><strong>Altitude:</strong> {Math.round(ac.baro_altitude)} m</p>
                    )}
                    {ac.velocity && (
                      <p><strong>Speed:</strong> {Math.round(ac.velocity * 3.6)} km/h</p>
                    )}
                    {ac.heading && (
                      <p><strong>Heading:</strong> {Math.round(ac.heading)}°</p>
                    )}
                    <p><strong>On Ground:</strong> {ac.on_ground ? 'Yes' : 'No'}</p>
                  </Popup>
                </Marker>
              );
            })
          ), [aircraft])}
        </MapContainer>
      </div>
    </div>
  );
}

export default App;
