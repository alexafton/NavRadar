import React, { useEffect, useState, useMemo } from 'react';
import { MapContainer, TileLayer } from 'react-leaflet';
import MarkerClusterGroup from 'react-leaflet-markercluster';
import L from 'leaflet';
import 'leaflet.markercluster'; // Import the core library
import 'leaflet/dist/leaflet.css';
import axios from 'axios';
import './index.css';

// --- Configuration ---
const OPENSKY_API_URL = 'https://opensky-network.org/api/states/all';

// --- Aircraft Icon ---
// Function to create an SVG icon for the aircraft, rotated by heading
const createAircraftIcon = (heading) => {
    // Handle invalid heading
    const validHeading = (heading !== null && !isNaN(heading)) ? heading : 0;

    return L.divIcon({
        className: 'aircraft-marker',
        iconSize: [20, 20],
        iconAnchor: [10, 10], // Center the icon
        popupAnchor: [0, -10],
        // Inline SVG for the airplane icon, rotated via CSS transform
        html: `
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" style="transform: rotate(${validHeading}deg);">
            <path fill="#e74c3c" d="M3.5,18.5L9,12.25V8.5L14,2L15.5,6.5L21,5L22,8L16.5,9.5L18,14L12.25,19L3.5,18.5Z" />
        </svg>
        `
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
            const response = await axios.get(OPENSKY_API_URL);
            console.log("OpenSky API Response:", response.data);

            if (response.data && Array.isArray(response.data.states)) {
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
            if (err.response) {
                setError(`API Error (${err.response.status}): ${err.response.statusText}`);
                console.error("Response data:", err.response.data);
            } else if (err.request) {
                setError("Network Error: No response received from OpenSky API.");
            } else {
                setError(`Request Error: ${err.message}`);
            }
        } finally {
            setLoading(false);
        }
    };

    // Fetch data on component mount and set up interval
    useEffect(() => {
        fetchAircraftData();
        const intervalId = setInterval(fetchAircraftData, 15000); // Fetch every 15s
        return () => clearInterval(intervalId);
    }, []);

    // --- Optimization: Memoize Aircraft Markers ---
    // This prevents re-creating the marker elements on every render if aircraft data hasn't changed significantly
    const aircraftMarkers = useMemo(() => {
        return aircraft.map((ac) => {
            if (ac.latitude === null || ac.longitude === null ||
                isNaN(ac.latitude) || isNaN(ac.longitude)) {
                return null; // Don't create markers for invalid data
            }

            const position = [ac.latitude, ac.longitude];
            const icon = createAircraftIcon(ac.heading); // Create the rotated icon

            // Create the marker element using Leaflet directly for better performance within the cluster group
            const marker = L.marker(position, { icon });

            // Bind popup content
            marker.bindPopup(`
                <div>
                    <h3>${ac.callsign || 'N/A'}</h3>
                    <p><strong>ICAO:</strong> ${ac.icao24}</p>
                    <p><strong>Country:</strong> ${ac.origin_country}</p>
                    <p><strong>Altitude:</strong> ${ac.baro_altitude !== null ? `${Math.round(ac.baro_altitude)} m` : 'N/A'}</p>
                    <p><strong>Speed:</strong> ${ac.velocity !== null ? `${Math.round(ac.velocity * 3.6)} km/h` : 'N/A'}</p> <!-- m/s to km/h -->
                    <p><strong>Heading:</strong> ${ac.heading !== null ? `${Math.round(ac.heading)}°` : 'N/A'}</p>
                    <p><strong>On Ground:</strong> ${ac.on_ground ? 'Yes' : 'No'}</p>
                </div>
            `);

            return marker;
        }).filter(m => m !== null); // Remove any null markers created due to invalid data
    }, [aircraft]); // Only re-run if aircraft array changes

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
                    center={[20, 0]}
                    zoom={2}
                    minZoom={2}
                    maxZoom={18}
                    worldCopyJump={true}
                    style={{ height: '100%', width: '100%' }}
                >
                    <TileLayer
                        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                    />

                    {/* Marker Cluster Group for Performance */}
                    <MarkerClusterGroup
                        showCoverageOnHover={false}
                        zoomToBoundsOnClick={true}
                        maxClusterRadius={50}
                        // disableClusteringAtZoom={14} // Optional: disable above zoom level
                        chunkedLoading={true} // Key for performance with many markers
                        chunkInterval={200}
                        chunkDelay={50}
                    >
                        {/* Render memoized markers */}
                        {aircraftMarkers}
                    </MarkerClusterGroup>
                </MapContainer>
            </div>
        </div>
    );
}

export default App;