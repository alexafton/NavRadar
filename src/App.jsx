import React, { useEffect, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import axios from 'axios';
import './index.css'; // Import your CSS

// --- Configuration ---
// Consider using environment variables for keys (e.g., VITE_OPENSKY_USERNAME, VITE_OPENSKY_PASSWORD)
// For simplicity, we'll try the public endpoint first.
const OPENSKY_API_URL = 'https://opensky-network.org/api/states/all';
// const OPENSKY_USERNAME = import.meta.env.VITE_OPENSKY_USERNAME; // Optional: Add to .env.local
// const OPENSKY_PASSWORD = import.meta.env.VITE_OPENSKY_PASSWORD; // Optional: Add to .env.local

// --- Aircraft Icon ---
// Create a simple blue circle icon for aircraft
const aircraftIcon = new L.DivIcon({
  className: 'aircraft-marker', // CSS class defined in index.css
  iconSize: [12, 12], // Match CSS width/height
  iconAnchor: [6, 6], // Center the icon
  popupAnchor: [0, -10] // Popup appears slightly above the marker
});

// --- Helper Function ---
// Rotate icon based on aircraft heading (simplified)
const getRotatedIcon = (heading) => {
  // Handle invalid or missing heading
  if (heading === null || heading === undefined || isNaN(heading)) {
    return aircraftIcon; // Return default icon without rotation
  }

  // Create a unique icon class with rotation
  const rotationClass = `aircraft-marker rotated-${Math.round(heading)}`;
  // Inject dynamic CSS for rotation (basic approach)
  const style = document.createElement('style');
  style.id = `rotation-style-${Math.round(heading)}`;
  if (!document.getElementById(style.id)) {
      style.innerHTML = `
          .${rotationClass}::after {
              content: '';
              position: absolute;
              top: -6px; /* Adjust based on marker size */
              left: 50%;
              transform: translateX(-50%);
              width: 0;
              height: 0;
              border-left: 3px solid transparent;
              border-right: 3px solid transparent;
              border-bottom: 6px solid white; /* Arrow color */
              transform-origin: 50% 100%;
              transform: translateX(-50%) rotate(${heading}deg);
          }
      `;
      document.head.appendChild(style);
  }

  return new L.DivIcon({
    className: rotationClass,
    iconSize: [12, 12],
    iconAnchor: [6, 6],
    popupAnchor: [0, -10]
  });
};

// --- Main App Component ---
function App() {
  const [aircraft, setAircraft] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Function to fetch aircraft data
  const fetchAircraftData = async () => {
    setLoading(true);
    setError(null);
    try {
      // For public access, no auth needed. For authenticated access:
      // const response = await axios.get(OPENSKY_API_URL, {
      //   auth: {
      //     username: OPENSKY_USERNAME,
      //     password: OPENSKY_PASSWORD
      //   }
      // });
      const response = await axios.get(OPENSKY_API_URL);
      console.log("OpenSky API Response:", response.data); // Debugging

      if (response.data && Array.isArray(response.data.states)) {
        // Process the aircraft data
        const processedAircraft = response.data.states.map(state => ({
          icao24: state[0],
          callsign: state[1] ? state[1].trim() : 'N/A',
          origin_country: state[2],
          time_position: state[3],
          last_contact: state[4],
          longitude: state[5],
          latitude: state[6],
          baro_altitude: state[7],
          on_ground: state[8],
          velocity: state[9],
          heading: state[10],
          vertical_rate: state[11],
          sensors: state[12],
          geo_altitude: state[13],
          squawk: state[14],
          spi: state[15],
          position_source: state[16]
        // Filter out aircraft without valid positions or on the ground if desired
        })).filter(ac => ac.longitude !== null && ac.latitude !== null /* && !ac.on_ground */);

        setAircraft(processedAircraft);
        console.log(`Processed ${processedAircraft.length} aircraft.`);
      } else {
        console.error("Unexpected API response structure:", response.data);
        setError("Received unexpected data format from OpenSky API.");
      }
    } catch (err) {
      console.error("Error fetching aircraft data:", err);
      // Provide more specific error messages if possible
      if (err.response) {
        // Server responded with error status
        setError(`API Error (${err.response.status}): ${err.response.statusText}`);
        console.error("Response ", err.response.data);
      } else if (err.request) {
        // Request was made but no response received
        setError("Network Error: No response received from OpenSky API.");
      } else {
        // Something else happened
        setError(`Request Error: ${err.message}`);
      }
    } finally {
      setLoading(false);
    }
  };

  // Fetch data on component mount and set up interval
  useEffect(() => {
    fetchAircraftData(); // Initial fetch

    // Set up interval to fetch data every 15 seconds
    const intervalId = setInterval(fetchAircraftData, 15000);

    // Clean up interval on component unmount
    return () => clearInterval(intervalId);
  }, []); // Empty dependency array means this runs once on mount

  return (
    <div>
      {/* Simple Header */}
      <div className="header">
        <h1>My Flight Tracker</h1>
        <div className="info">
          {loading && <span>Loading aircraft...</span>}
          {error && <span style={{ color: 'red' }}>Error: {error}</span>}
          {!loading && !error && <span>{aircraft.length} aircraft tracked</span>}
        </div>
      </div>

      {/* Map Container */}
      <div className="map-container">
        <MapContainer
          center={[20, 0]} // Initial center
          zoom={2}         // Initial zoom
          minZoom={2}      // Prevent zooming out too far
          maxZoom={18}     // Prevent zooming in too far
          worldCopyJump={true} // Allow panning across the antimeridian
          style={{ height: '100%', width: '100%' }} // Ensure map fills container
        >
          {/* OpenStreetMap Tiles */}
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />

          {/* Aircraft Markers */}
          {aircraft.map((ac) => {
            // Validate coordinates
            if (ac.latitude === null || ac.longitude === null ||
                isNaN(ac.latitude) || isNaN(ac.longitude)) {
              return null; // Don't render invalid markers
            }

            const position = [ac.latitude, ac.longitude];
            const icon = getRotatedIcon(ac.heading); // Get potentially rotated icon

            return (
              <Marker
                key={ac.icao24} // Unique key for React
                position={position}
                icon={icon} // Use the custom icon
              >
                <Popup>
                  <h3>{ac.callsign || 'N/A'}</h3>
                  <p><strong>ICAO:</strong> {ac.icao24}</p>
                  <p><strong>Country:</strong> {ac.origin_country}</p>
                  <p><strong>Altitude:</strong> {ac.baro_altitude !== null ? `${Math.round(ac.baro_altitude)} m` : 'N/A'}</p>
                  <p><strong>Speed:</strong> {ac.velocity !== null ? `${Math.round(ac.velocity * 3.6)} km/h` : 'N/A'}</p> {/* Convert m/s to km/h */}
                  <p><strong>Heading:</strong> {ac.heading !== null ? `${Math.round(ac.heading)}°` : 'N/A'}</p>
                  <p><strong>On Ground:</strong> {ac.on_ground ? 'Yes' : 'No'}</p>
                </Popup>
              </Marker>
            );
          })}
        </MapContainer>
      </div>
    </div>
  );
}

export default App;
