// ── Emojis & helpers ──────────────────────────────────────────────
const EMOJIS = ['☕','🧁','🍰','🌸','🍵','📚','🌿','🎀','🫖','🍮','🥐','🍩'];
const DAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

// Keywords used to award filter tags to each place
const FILTER_KEYWORDS = {
  wifi:    ['wifi','wi-fi','internet','coworking','co-working','laptop'],
  pet:     ['pet','dog','cat','animal'],
  outdoor: ['outdoor','garden','terrace','patio','rooftop','balcony'],
};

// ── State ─────────────────────────────────────────────────────────
let map, placesService, infoWindow, geocoder;
let allPlaces    = [];       // raw results from Places API
let markers      = [];       // parallel array of Marker objects
let activeFilter = 'all';
let activeCardEl = null;
let activeMarkerIdx = null;

// ── Init ──────────────────────────────────────────────────────────
function initMap() {
  const defaultCenter = { lat: 27.7172, lng: 85.3240 }; // Kathmandu

  map = new google.maps.Map(document.getElementById('map'), {
    center: defaultCenter,
    zoom: 14,
    styles: mapStyles(),
    mapTypeControl: false,
    streetViewControl: false,
    fullscreenControl: true,
    zoomControl: true,
  });

  placesService = new google.maps.places.PlacesService(map);
  infoWindow    = new google.maps.InfoWindow();
  geocoder      = new google.maps.Geocoder();

  // Wire up buttons
  document.getElementById('search-btn').addEventListener('click', doSearch);
  document.getElementById('search-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') doSearch();
  });
  document.getElementById('locate-btn').addEventListener('click', useMyLocation);
  document.getElementById('close-detail').addEventListener('click', closeDetail);

  // Wire up filter chips
  document.querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      activeFilter = chip.dataset.filter;
      renderSidebar();
      updateMarkerVisibility();
    });
  });
}

// ── Search by typed text ──────────────────────────────────────────
function doSearch() {
  const query = document.getElementById('search-input').value.trim();
  if (!query) return;

  setStatus('Searching location...');
  geocoder.geocode({ address: query }, (results, status) => {
    if (status === 'OK' && results[0]) {
      const loc = results[0].geometry.location;
      map.setCenter(loc);
      map.setZoom(15);
      fetchCafes(loc);
    } else {
      setStatus('Location not found. Try a different search.');
    }
  });
}

// ── Use device location ───────────────────────────────────────────
function useMyLocation() {
  if (!navigator.geolocation) { alert('Geolocation not supported.'); return; }
  setStatus('Getting your location...');
  navigator.geolocation.getCurrentPosition(
    pos => {
      const loc = new google.maps.LatLng(pos.coords.latitude, pos.coords.longitude);
      map.setCenter(loc);
      map.setZoom(15);
      fetchCafes(loc);
    },
    () => setStatus('Could not get location. Try searching instead.')
  );
}

// ── Fetch cafes via Places Nearby Search ──────────────────────────
function fetchCafes(location) {
  clearAll();
  setStatus('Finding cafes...');
  showLoading('☕ Brewing results...');

  placesService.nearbySearch(
    { location, radius: 1500, type: 'cafe' },
    (results, status) => {
      if (status === google.maps.places.PlacesServiceStatus.OK && results.length) {
        allPlaces = results;
        results.forEach((place, i) => createMarker(place, i));
        renderSidebar();
        setStatus(`${results.length} cafes found nearby`);
      } else {
        showMsg('😔', 'No cafes found here. Try a different location!');
        setStatus('No cafes found.');
      }
    }
  );
}

// ── Render sidebar list based on active filter ────────────────────
function renderSidebar() {
  const list    = document.getElementById('cafe-list');
  const msgEl   = document.getElementById('sidebar-msg');
  msgEl.style.display = 'none';
  list.innerHTML = '';

  const filtered = getFilteredPlaces();
  if (!filtered.length) {
    list.innerHTML = `<div class="loading-msg">No cafes match this filter.</div>`;
    return;
  }

  filtered.forEach(({ place, originalIndex }) => {
    const card = buildCard(place, originalIndex);
    list.appendChild(card);
  });
}

// ── Filter logic ──────────────────────────────────────────────────
function getFilteredPlaces() {
  return allPlaces
    .map((place, i) => ({ place, originalIndex: i }))
    .filter(({ place }) => {
      if (activeFilter === 'all') return true;
      if (activeFilter === 'open') {
        return place.opening_hours?.isOpen?.() === true;
      }
      if (activeFilter === 'top') {
        return (place.rating || 0) >= 4.0;
      }
      const kws = FILTER_KEYWORDS[activeFilter] || [];
      const haystack = [place.name, ...(place.types || [])].join(' ').toLowerCase();
      return kws.some(kw => haystack.includes(kw));
    });
}

// ── Build a sidebar card element ──────────────────────────────────
function buildCard(place, index) {
  const emoji  = EMOJIS[index % EMOJIS.length];
  const isOpen = place.opening_hours?.isOpen?.();
  const dist   = distText(place.geometry.location);

  const card = document.createElement('div');
  card.className = 'cafe-card';
  card.dataset.index = index;

  const openTag = isOpen === true  ? `<span class="tag open">Open now</span>`
                : isOpen === false ? `<span class="tag closed">Closed</span>`
                : '';

  const ratingTag = place.rating
    ? `<span class="tag rating">★ ${place.rating}</span>` : '';

  card.innerHTML = `
    <div class="cafe-card-top">
      <div class="cafe-emoji-box">${emoji}</div>
      <div class="cafe-card-info">
        <h3>${esc(place.name)}</h3>
        <p>${place.vicinity ? esc(place.vicinity) : ''}${dist ? ' · ' + dist : ''}</p>
      </div>
    </div>
    <div class="cafe-card-meta">
      ${openTag}
      ${ratingTag}
      ${tagPills(place)}
    </div>
  `;

  card.addEventListener('click', () => {
    selectPlace(index);
    // Fetch full details and open panel
    fetchDetails(place.place_id, index);
  });

  return card;
}

// ── Select a place (highlight card + pan map) ─────────────────────
function selectPlace(index) {
  // Deactivate previous card
  if (activeCardEl) activeCardEl.classList.remove('active');
  const card = document.querySelector(`.cafe-card[data-index="${index}"]`);
  if (card) {
    card.classList.add('active');
    card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    activeCardEl = card;
  }

  const place = allPlaces[index];
  if (place) {
    map.panTo(place.geometry.location);
    map.setZoom(16);
    infoWindow.close();
  }
  activeMarkerIdx = index;
}

// ── Fetch full Place Details ──────────────────────────────────────
function fetchDetails(placeId, index) {
  placesService.getDetails(
    {
      placeId,
      fields: [
        'name', 'formatted_address', 'formatted_phone_number',
        'opening_hours', 'rating', 'user_ratings_total',
        'website', 'price_level', 'reviews', 'photos',
        'geometry', 'place_id', 'types',
      ],
    },
    (place, status) => {
      if (status === google.maps.places.PlacesServiceStatus.OK) {
        openDetailPanel(place, index);
      }
    }
  );
}

// ── Open side detail panel ────────────────────────────────────────
function openDetailPanel(place, index) {
  const panel   = document.getElementById('detail-panel');
  const content = document.getElementById('detail-content');
  const emoji   = EMOJIS[index % EMOJIS.length];
  const isOpen  = place.opening_hours?.isOpen?.();
  const today   = new Date().getDay(); // 0=Sun

  // ── Hours ──
  let hoursHtml = '';
  if (place.opening_hours?.weekday_text?.length) {
    const rows = place.opening_hours.weekday_text.map((line, i) => {
      // weekday_text starts Monday (index 0), but getDay() is 0=Sun
      // Google's weekday_text[0] = Monday, so today index = (today + 6) % 7
      const todayIdx = (today + 6) % 7;
      const isToday = i === todayIdx;
      const [day, ...timeParts] = line.split(': ');
      return `<div class="hours-row ${isToday ? 'today' : ''}">
        <span class="hours-day">${day}</span>
        <span>${timeParts.join(': ')}</span>
      </div>`;
    }).join('');
    hoursHtml = `
      <div class="detail-section">
        <div class="detail-section-title">Opening Hours</div>
        <div class="hours-list">${rows}</div>
      </div>`;
  }

  // ── Contact ──
  let contactHtml = '';
  if (place.formatted_phone_number || place.website) {
    contactHtml = `<div class="detail-section">
      <div class="detail-section-title">Contact</div>
      ${place.formatted_phone_number
        ? `<div class="detail-row"><span class="detail-row-icon">📞</span><span>${esc(place.formatted_phone_number)}</span></div>` : ''}
      ${place.website
        ? `<div class="detail-row"><span class="detail-row-icon">🌐</span><a href="${place.website}" target="_blank" style="color:#7f77dd;font-size:13px;word-break:break-all">${esc(place.website)}</a></div>` : ''}
    </div>`;
  }

  // ── Price level ──
  const priceStr = place.price_level != null
    ? ['Free','Budget ₹','Moderate ₹₹','Pricey ₹₹₹','Luxury ₹₹₹₹'][place.price_level] || '' : '';

  // ── Directions URL ──
  const lat = place.geometry.location.lat();
  const lng = place.geometry.location.lng();
  const mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&destination_place_id=${place.place_id}`;
  const gmapsUrl = `https://www.google.com/maps/place/?q=place_id:${place.place_id}`;

  content.innerHTML = `
    <div class="detail-header">
      <div class="detail-emoji">${emoji}</div>
      <div class="detail-name">${esc(place.name)}</div>
      <div class="detail-addr">${place.formatted_address ? esc(place.formatted_address) : ''}</div>
      <div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap">
        ${isOpen === true  ? '<span class="tag open">Open now</span>' : ''}
        ${isOpen === false ? '<span class="tag closed">Closed now</span>' : ''}
        ${place.rating ? `<span class="tag rating">★ ${place.rating} (${place.user_ratings_total || 0})</span>` : ''}
        ${priceStr ? `<span class="tag">${priceStr}</span>` : ''}
      </div>
    </div>

    ${hoursHtml}
    ${contactHtml}

    <div class="detail-tags">
      ${tagPills(place)}
    </div>

    <a class="btn-directions" href="${mapsUrl}" target="_blank">
      🧭 Get Directions
    </a>
    <a class="btn-gmaps" href="${gmapsUrl}" target="_blank">
      🗺️ View on Google Maps
    </a>
  `;

  panel.classList.remove('hidden');
}

function closeDetail() {
  document.getElementById('detail-panel').classList.add('hidden');
}

// ── Create a map marker ───────────────────────────────────────────
function createMarker(place, index) {
  const emoji = EMOJIS[index % EMOJIS.length];

  const marker = new google.maps.Marker({
    map,
    position: place.geometry.location,
    title: place.name,
    icon: {
      url: svgPin(emoji),
      scaledSize: new google.maps.Size(40, 40),
      anchor: new google.maps.Point(20, 40),
    },
  });

  marker.addListener('click', () => {
    selectPlace(index);
    fetchDetails(place.place_id, index);
  });

  markers[index] = marker;
}

// ── Show/hide markers based on filter ────────────────────────────
function updateMarkerVisibility() {
  const visibleIndices = new Set(getFilteredPlaces().map(f => f.originalIndex));
  markers.forEach((m, i) => {
    if (m) m.setMap(visibleIndices.has(i) ? map : null);
  });
}

// ── SVG pin data URL ──────────────────────────────────────────────
function svgPin(emoji) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40">
    <circle cx="20" cy="17" r="15" fill="#7f77dd" stroke="#fff" stroke-width="2"/>
    <text x="20" y="22" text-anchor="middle" font-size="15">${emoji}</text>
    <polygon points="15,29 25,29 20,40" fill="#7f77dd"/>
  </svg>`;
  return 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg);
}

// ── Tag pills heuristic ───────────────────────────────────────────
function tagPills(place) {
  const src = [place.name, ...(place.types || [])].join(' ').toLowerCase();
  let html = '';
  if (FILTER_KEYWORDS.wifi.some(k => src.includes(k)))    html += `<span class="tag">📶 Wi-Fi</span>`;
  if (FILTER_KEYWORDS.pet.some(k => src.includes(k)))     html += `<span class="tag">🐾 Pet friendly</span>`;
  if (FILTER_KEYWORDS.outdoor.some(k => src.includes(k))) html += `<span class="tag">🌿 Outdoor</span>`;
  if (src.includes('bakery') || src.includes('pastry'))   html += `<span class="tag">🥐 Bakery</span>`;
  if (src.includes('book'))                               html += `<span class="tag">📚 Books</span>`;
  return html;
}

// ── Utilities ─────────────────────────────────────────────────────
function clearAll() {
  markers.forEach(m => m && m.setMap(null));
  markers = [];
  allPlaces = [];
  activeCardEl = null;
  activeMarkerIdx = null;
  infoWindow.close();
  closeDetail();
  document.getElementById('cafe-list').innerHTML = '';
  document.getElementById('sidebar-msg').style.display = 'none';
}

function showLoading(msg) {
  document.getElementById('cafe-list').innerHTML =
    `<div class="loading-msg">${msg}</div>`;
}

function showMsg(icon, text) {
  document.getElementById('cafe-list').innerHTML = '';
  const msg = document.getElementById('sidebar-msg');
  msg.style.display = 'flex';
  msg.innerHTML = `<span>${icon}</span><p>${text}</p>`;
}

function setStatus(msg) {
  document.getElementById('status-text').textContent = msg;
}

function esc(str) {
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function distText(latLng) {
  const c = map.getCenter();
  if (!c) return '';
  const R = 6371000;
  const lat1 = c.lat() * Math.PI/180, lat2 = latLng.lat() * Math.PI/180;
  const dLat = (latLng.lat() - c.lat()) * Math.PI/180;
  const dLng = (latLng.lng() - c.lng()) * Math.PI/180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1)*Math.cos(lat2)*Math.sin(dLng/2)**2;
  const d = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return d < 1000 ? `${Math.round(d)} m` : `${(d/1000).toFixed(1)} km`;
}

// ── Pastel map styles ─────────────────────────────────────────────
function mapStyles() {
  return [
    { featureType:'water',    elementType:'geometry',        stylers:[{color:'#c5dff8'}] },
    { featureType:'road',     elementType:'geometry.fill',   stylers:[{color:'#ffffff'}] },
    { featureType:'road',     elementType:'geometry.stroke', stylers:[{color:'#e8e0f8'}] },
    { featureType:'poi.park', elementType:'geometry',        stylers:[{color:'#d4eabf'}] },
    { featureType:'landscape',elementType:'geometry',        stylers:[{color:'#f5f0fa'}] },
    { featureType:'poi',      elementType:'labels',          stylers:[{visibility:'off'}] },
    { featureType:'road',     elementType:'labels.text.fill',stylers:[{color:'#9b92cc'}] },
    { featureType:'road.highway',elementType:'geometry.fill',stylers:[{color:'#ece8fb'}] },
    { featureType:'transit',  elementType:'geometry',        stylers:[{color:'#e8ddf4'}] },
  ];
}