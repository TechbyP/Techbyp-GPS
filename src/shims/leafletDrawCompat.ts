// Compatibility shim for react-leaflet-draw.
// leaflet-draw exposes side effects but no ESM default export.
import 'leaflet-draw/dist/leaflet.draw.js';

const leafletDrawCompat = {};

export default leafletDrawCompat;
