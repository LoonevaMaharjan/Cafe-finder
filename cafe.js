// ── Config ────────────────────────────────────────────────────────
const CAFE_EMOJIS = ['☕', '🧁', '🍰', '🌸', '🍵', '📚', '🌿', '🎀', '🫖', '🍮'];

// Keyword labels for Places API types (used to assign filter tags visually)
const KEYWORD_TAGS = {
  wifi:    ['wifi', 'wi-fi', 'internet'],
  pet:     ['pet', 'dog', 'cat friendly'],
  outdoor: ['outdoor', 'terrace', 'garden', 'patio'],
};

// ── State ─────────────────────────────────────────────────────────
let map, service, infoWindow;
let currentMarkers = [];
let currentPlaces  = [];
let activeFilter   = 'all';
let activeCard     = null;

// ── Init (called by Google Maps callback) ─────────────────────────
function initMap() {
  const defaultCenter = { lat: 27.7172, lng: 85.3240 }; // Kathmandu

  map = new google.maps.Map(document.getElementById('map'), {
    center: defaultCenter,
    zoom: 14,
    styles: mapStyles(),        // cute pastel style
    disableDefaultUI: false,
    zoomControl: true,
    mapTypeControl: false,
    streetViewControl: false,
    fullscreenControl: true,
  });

  service   = new google.maps.places.PlacesService(map);
  infoWindow = new google.maps.InfoWindow({ maxWidth: 300 });

  // Buttons
  document.getElementById('search-btn').addEventListener('click', onSearchClick);
  document.getElementById('search-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') onSearchClick();
  });
  document.getElementById('locate-btn').addEventListener('click', useMyLocation);

  // Filter chips
  document.getElementById('filters').addEventListener('click', e => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    activeFilter = chip.dataset.filter;
    renderSidebar(currentPlaces);
  });
}

// ── Search by typed location ──────────────────────────────────────
function onSearchClick() {
  const query = document.getElementById('search-input').value.trim();
  if (!query) return;

  const geocoder = new google.maps.Geocoder();
  geocoder.geocode({ address: query }, (results, status) => {
    if (status === 'OK' && results[0]) {
      const loc = results[0].geometry.location;
      map.setCenter(loc);
      map.setZoom(14);
      searchCafesNear(loc);
    } else {
      setStatus('Location not found. Try a different search.');
    }
  });
}

// ── Use geolocation ───────────────────────────────────────────────
function useMyLocation() {
  if (!navigator.geolocation) {
    alert('Geolocation is not supported by your browser.');
    return;
  }
  setStatus('Finding your location...');
  navigator.geolocation.getCurrentPosition(
    pos => {
      const loc = new google.maps.LatLng(pos.coords.latitude, pos.coords.longitude);
      map.setCenter(loc);
      map.setZoom(14);
      searchCafesNear(loc);
    },
    () => setStatus('Could not get your location. Try searching instead.')
  );
}

// ── Places Nearby Search ──────────────────────────────────────────
function searchCafesNear(location) {
  clearMarkers();
  setStatus('Searching for cafes...');
  showLoading();

  const request = {
    location,
    radius: 1500,           // metres
    type: 'cafe',
    keyword: 'cafe coffee',
  };

  service.nearbySearch(request, (results, status) => {
    if (status === google.maps.places.PlacesServiceStatus.OK && results.length) {
      currentPlaces = results;
      renderSidebar(results);
      results.forEach((place, i) => addMarker(place, i));
      setStatus(`${results.length} cafes found nearby ☕`);
    } else {
      document.getElementById('cafe-list').innerHTML = '';
      document.getElementById('sidebar-msg').style.display = 'flex';
      document.getElementById('sidebar-msg').innerHTML =
        '<span>😔</span><p>No cafes found here. Try zooming out or searching elsewhere!</p>';
      setStatus('No results found.');
    }
  });
}

// ── Render sidebar list ───────────────────────────────────────────
function renderSidebar(places) {
  const list   = document.getElementById('cafe-list');
  const msg    = document.getElementById('sidebar-msg');
  msg.style.display = 'none';
  list.innerHTML = '';

  const filtered = filterPlaces(places);

  if (!filtered.length) {
    list.innerHTML = `<div class="loading">No cafes match this filter.</div>`;
    return;
  }

  filtered.forEach((place, i) => {
    const emoji  = CAFE_EMOJIS[i % CAFE_EMOJIS.length];
    const rating = place.rating ? '★'.repeat(Math.round(place.rating)) + ` (${place.rating})` : 'No rating';
    const isOpen = place.opening_hours?.isOpen?.();
    const openTag = isOpen === true  ? `<span class="tag open">Open</span>`
                  : isOpen === false ? `<span class="tag closed">Closed</span>`
                  : '';
    const dist   = getDistanceText(place.geometry.location);

    const card = document.createElement('div');
    card.className = 'cafe-card';
    card.dataset.placeId = place.place_id;
    card.innerHTML = `
      <div class="cafe-card-top">
        <div class="cafe-emoji-box">${emoji}</div>
        <div class="cafe-card-info">
          <h3>${escHtml(place.name)}</h3>
          <p>${place.vicinity ? escHtml(place.vicinity) : ''}${dist ? ' · ' + dist : ''}</p>
        </div>
      </div>
      <div class="cafe-card-meta">
        <span class="stars">${rating}</span>
        ${openTag}
        ${tagsHtml(place)}
      </div>
    `;

    card.addEventListener('click', () => selectCard(card, place, i));
    list.appendChild(card);
  });
}

// ── Filter logic ─────────────────────────────────────────────────
function filterPlaces(places) {
  if (activeFilter === 'all') return places;
  if (activeFilter === 'open') {
    return places.filter(p => p.opening_hours?.isOpen?.() === true);
  }
  const keywords = KEYWORD_TAGS[activeFilter] || [];
  return places.filter(p => {
    const text = [(p.name || ''), (p.vicinity || ''), ...(p.types || [])].join(' ').toLowerCase();
    return keywords.some(kw => text.includes(kw));
  });
}

// ── Tag pills (heuristic from name/types) ─────────────────────────
function tagsHtml(place) {
  const src = [(place.name || ''), ...(place.types || [])].join(' ').toLowerCase();
  let html = '';
  if (src.includes('book') || src.includes('library')) html += `<span class="tag">📚 Books</span>`;
  if (src.includes('garden') || src.includes('garden') || src.includes('park')) html += `<span class="tag">🌿 Garden</span>`;
  if (place.price_level <= 2) html += `<span class="tag">💰 Budget</span>`;
  return html;
}

// ── Select a cafe (card + marker) ────────────────────────────────
function selectCard(cardEl, place, index) {
  if (activeCard) activeCard.classList.remove('active');
  cardEl.classList.add('active');
  activeCard = cardEl;

  map.panTo(place.geometry.location);
  map.setZoom(16);

  const marker = currentMarkers[index];
  if (marker) google.maps.event.trigger(marker, 'click');
}

// ── Add map marker ────────────────────────────────────────────────
function addMarker(place, index) {
  const emoji = CAFE_EMOJIS[index % CAFE_EMOJIS.length];

  const marker = new google.maps.Marker({
    map,
    position: place.geometry.location,
    title: place.name,
    icon: {
      url: svgMarkerUrl(emoji),
      scaledSize: new google.maps.Size(38, 38),
      anchor: new google.maps.Point(19, 38),
    }
  });

  marker.addListener('click', () => {
    const isOpen = place.opening_hours?.isOpen?.();
    const mapsUrl = `https://www.google.com/maps/place/?q=place_id:${place.place_id}`;
    const content = `
      <div class="info-window">
        <div class="info-emoji">${emoji}</div>
        <div class="info-body">
          <h3>${escHtml(place.name)}</h3>
          <p>${place.vicinity ? escHtml(place.vicinity) : ''}</p>
          <p>${place.rating ? '★ ' + place.rating : ''} ${isOpen === true ? '· <span style="color:#3b6d11">Open now</span>' : isOpen === false ? '· <span style="color:#a32d2d">Closed</span>' : ''}</p>
          <a href="${mapsUrl}" target="_blank" rel="noopener">Open in Maps ↗</a>
        </div>
      </div>`;
    infoWindow.setContent(content);
    infoWindow.open(map, marker);

    // Sync sidebar card
    const cards = document.querySelectorAll('.cafe-card');
    cards.forEach(c => c.classList.remove('active'));
    const match = [...cards].find(c => c.dataset.placeId === place.place_id);
    if (match) {
      match.classList.add('active');
      match.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      activeCard = match;
    }
  });

  currentMarkers[index] = marker;
}

// ── SVG pin as data URL ───────────────────────────────────────────
function svgMarkerUrl(emoji) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="38" height="38" viewBox="0 0 38 38">
    <circle cx="19" cy="16" r="15" fill="#7f77dd" stroke="#fff" stroke-width="2"/>
    <text x="19" y="21" text-anchor="middle" font-size="16">${emoji}</text>
    <polygon points="14,28 24,28 19,38" fill="#7f77dd"/>
  </svg>`;
  return 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg);
}

// ── Utility: clear all markers ────────────────────────────────────
function clearMarkers() {
  currentMarkers.forEach(m => m && m.setMap(null));
  currentMarkers = [];
  currentPlaces  = [];
  infoWindow.close();
}

// ── Utility: distance text ────────────────────────────────────────
function getDistanceText(latLng) {
  const center = map.getCenter();
  if (!center) return '';
  const R = 6371e3;
  const lat1 = center.lat() * Math.PI / 180;
  const lat2 = latLng.lat()  * Math.PI / 180;
  const dLat = (latLng.lat()  - center.lat()) * Math.PI / 180;
  const dLng = (latLng.lng()  - center.lng()) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1)*Math.cos(lat2)*Math.sin(dLng/2)**2;
  const d = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return d < 1000 ? `${Math.round(d)} m` : `${(d/1000).toFixed(1)} km`;
}

// ── Utility: HTML escape ──────────────────────────────────────────
function escHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Status bar helper ─────────────────────────────────────────────
function setStatus(msg) {
  document.getElementById('status-text').textContent = msg;
}

// ── Loading state ─────────────────────────────────────────────────
function showLoading() {
  document.getElementById('cafe-list').innerHTML =
    `<div class="loading">☕ Brewing results...</div>`;
  document.getElementById('sidebar-msg').style.display = 'none';
}

// ── Cute pastel map styles ────────────────────────────────────────
function mapStyles() {
  return [
    { featureType: 'all',      elementType: 'geometry',          stylers: [{ saturation: -20 }] },
    { featureType: 'water',    elementType: 'geometry',          stylers: [{ color: '#c5dff8' }] },
    { featureType: 'road',     elementType: 'geometry.fill',     stylers: [{ color: '#ffffff' }] },
    { featureType: 'road',     elementType: 'geometry.stroke',   stylers: [{ color: '#e8e0f8' }] },
    { featureType: 'poi.park', elementType: 'geometry',          stylers: [{ color: '#d4eabf' }] },
    { featureType: 'landscape',elementType: 'geometry',          stylers: [{ color: '#f5f0fa' }] },
    { featureType: 'transit',  elementType: 'geometry',          stylers: [{ color: '#e8ddf4' }] },
    { featureType: 'poi',      elementType: 'labels',            stylers: [{ visibility: 'off' }] },
    { featureType: 'poi.business', elementType: 'labels',        stylers: [{ visibility: 'off' }] },
    { featureType: 'road',     elementType: 'labels.text.fill',  stylers: [{ color: '#9b92cc' }] },
    { featureType: 'road.highway', elementType: 'geometry.fill', stylers: [{ color: '#ece8fb' }] },
  ];
}