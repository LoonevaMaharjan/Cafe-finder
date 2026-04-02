// ─────────────────────────────────────────────────────────────────
//  CAFÉ FINDER — app.js
//  Fixes:
//  1. Filters (Open Now, Top Rated, Wi-Fi, Pet, Outdoor, Budget)
//     → Wi-Fi / Pet / Outdoor fetch real Place Details reviews +
//       amenity fields from the Places API
//  2. Location search → geocodes the typed text and searches there
//  3. Scroll-based search → "Search this area" button appears when
//     the user pans/zooms the map
// ─────────────────────────────────────────────────────────────────

const EMOJIS = ['☕','🧁','🍰','🌸','🍵','📚','🌿','🎀','🫖','🍮','🥐','🍩','🧇','🫗','🍫'];

// ── State ─────────────────────────────────────────────────────────
let map, svc, geocoder, infoWindow;
let allPlaces      = [];   // raw nearbySearch results
let detailsCache   = {};   // placeId → full Place Details object
let markers        = [];   // parallel to allPlaces
let activeFilter   = 'all';
let activeCardEl   = null;
let mapMoved       = false; // track whether user panned/zoomed
let searchAreaTimeout;

// ── Boot ──────────────────────────────────────────────────────────
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

  svc       = new google.maps.places.PlacesService(map);
  geocoder  = new google.maps.Geocoder();
  infoWindow = new google.maps.InfoWindow();

  // Buttons
  document.getElementById('search-btn')
    .addEventListener('click', doSearch);
  document.getElementById('search-input')
    .addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(); });
  document.getElementById('locate-btn')
    .addEventListener('click', useMyLocation);
  document.getElementById('close-detail')
    .addEventListener('click', closeDetail);
  document.getElementById('search-area-btn')
    .addEventListener('click', searchCurrentArea);

  // Filters
  document.querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      activeFilter = chip.dataset.filter;
      renderSidebar();
      syncMarkers();
    });
  });

  // ── Show "Search this area" when user moves the map ──────────
  map.addListener('dragend', onMapMoved);
  map.addListener('zoom_changed', onMapMoved);
}

function onMapMoved() {
  if (allPlaces.length === 0) return; // don't show before first search
  clearTimeout(searchAreaTimeout);
  searchAreaTimeout = setTimeout(() => {
    document.getElementById('search-area-btn').classList.remove('hidden');
  }, 500);
}

function searchCurrentArea() {
  document.getElementById('search-area-btn').classList.add('hidden');
  fetchCafesNear(map.getCenter(), null);
}

// ── Search by typed text ──────────────────────────────────────────
// Uses Places TextSearch ("cafe in <query>") — works without Geocoding API,
// and understands neighbourhood/city names directly.
// Falls back to Geocoder + nearbySearch if TextSearch returns nothing.
function doSearch() {
  const query = document.getElementById('search-input').value.trim();
  if (!query) return;

  setStatus('Searching...');
  document.getElementById('search-area-btn').classList.add('hidden');
  clearAll();
  showSkeleton();

  // Primary: textSearch for "cafe in <location>"
  svc.textSearch({ query: `cafe in ${query}` }, (results, status) => {
    if (status === google.maps.places.PlacesServiceStatus.OK && results.length) {
      const center = results[0].geometry.location;
      map.setCenter(center);
      map.setZoom(14);
      allPlaces = results;
      results.forEach((place, i) => addMarker(place, i));
      prefetchDetails(results.slice(0, 15), () => {
        renderSidebar();
        setStatus(`${results.length} cafes found in "${query}"`);
      });
    } else {
      // Fallback: geocode the location then do nearbySearch
      setStatus('Locating on map...');
      geocoder.geocode({ address: query }, (gResults, gStatus) => {
        if (gStatus === 'OK' && gResults[0]) {
          const loc = gResults[0].geometry.location;
          map.setCenter(loc);
          map.setZoom(15);
          fetchCafesNear(loc, query);
        } else {
          showMsg('❌', 'Location not found', `Try something like "Thamel, Kathmandu" or "Patan".`);
          setStatus('Location not found.');
        }
      });
    }
  });
}

// ── Geolocation ───────────────────────────────────────────────────
function useMyLocation() {
  if (!navigator.geolocation) { alert('Geolocation not supported.'); return; }
  setStatus('Getting your location...');
  navigator.geolocation.getCurrentPosition(
    pos => {
      const loc = new google.maps.LatLng(pos.coords.latitude, pos.coords.longitude);
      map.setCenter(loc);
      map.setZoom(15);
      fetchCafesNear(loc, 'your location');
    },
    () => setStatus('Could not get location. Try searching instead.')
  );
}

// ── Fetch nearby cafes by lat/lng (used by My Location + Search Area) ──
function fetchCafesNear(location, label) {
  clearAll();
  setStatus('Searching for cafes...');
  showSkeleton();

  svc.nearbySearch(
    { location, radius: 1500, type: 'cafe' },
    (results, status) => {
      if (status === google.maps.places.PlacesServiceStatus.OK && results.length) {
        allPlaces = results;
        results.forEach((place, i) => addMarker(place, i));
        prefetchDetails(results.slice(0, 15), () => {
          renderSidebar();
          setStatus(`${results.length} cafes found${label ? ' near "' + label + '"' : ''}`);
        });
      } else {
        // nearbySearch with type:'cafe' can be strict — retry with keyword
        svc.nearbySearch(
          { location, radius: 2000, keyword: 'coffee cafe restaurant' },
          (r2, s2) => {
            if (s2 === google.maps.places.PlacesServiceStatus.OK && r2.length) {
              allPlaces = r2;
              r2.forEach((place, i) => addMarker(place, i));
              prefetchDetails(r2.slice(0, 15), () => {
                renderSidebar();
                setStatus(`${r2.length} cafes found nearby`);
              });
            } else {
              showMsg('😔', 'No cafes found here', 'Try a different location or use "Search this area" after panning.');
              setStatus('No cafes found.');
            }
          }
        );
      }
    }
  );
}

// ── Pre-fetch Place Details for top N results ─────────────────────
//   This gives us opening_hours, amenities, reviews etc.
function prefetchDetails(places, callback) {
  let done = 0;
  if (places.length === 0) { callback(); return; }

  places.forEach(place => {
    if (detailsCache[place.place_id]) {
      done++;
      if (done === places.length) callback();
      return;
    }
    svc.getDetails(
      {
        placeId: place.place_id,
        fields: [
          'place_id','name','formatted_address','formatted_phone_number',
          'opening_hours','rating','user_ratings_total',
          'website','price_level','reviews','geometry','types',
        ],
      },
      (detail, detStatus) => {
        if (detStatus === google.maps.places.PlacesServiceStatus.OK) {
          detailsCache[place.place_id] = detail;
        }
        done++;
        if (done === places.length) callback();
      }
    );
  });
}

// ── Filter logic (uses cached details where available) ────────────
function getFiltered() {
  return allPlaces
    .map((place, i) => ({ place, idx: i }))
    .filter(({ place }) => {
      if (activeFilter === 'all') return true;

      const d = detailsCache[place.place_id]; // may be undefined for uncached

      if (activeFilter === 'open') {
        const hours = d?.opening_hours || place.opening_hours;
        return hours?.isOpen?.() === true;
      }

      if (activeFilter === 'top') {
        const r = d?.rating ?? place.rating ?? 0;
        return r >= 4.0;
      }

      if (activeFilter === 'cheap') {
        const p = d?.price_level ?? place.price_level;
        return p != null && p <= 1;
      }

      // ── Amenity filters: search reviews + name + types ───────
      if (activeFilter === 'wifi' || activeFilter === 'pet' || activeFilter === 'outdoor') {
        const KEYWORDS = {
          wifi:    ['wifi','wi-fi','internet','coworking','laptop','wireless'],
          pet:     ['pet','dog','cat','animal','friendly','paw'],
          outdoor: ['outdoor','garden','terrace','patio','rooftop','seating outside','open air'],
        };
        const kws = KEYWORDS[activeFilter];

        // Build a big text blob from all available data
        const namePart  = (d?.name || place.name || '').toLowerCase();
        const typesPart = (d?.types || place.types || []).join(' ').toLowerCase();
        const addrPart  = (d?.formatted_address || place.vicinity || '').toLowerCase();

        // Reviews are the best source for amenity data
        const reviewsPart = (d?.reviews || [])
          .map(r => r.text || '')
          .join(' ')
          .toLowerCase();

        const haystack = [namePart, typesPart, addrPart, reviewsPart].join(' ');
        return kws.some(kw => haystack.includes(kw));
      }

      return true;
    });
}

// ── Render sidebar ────────────────────────────────────────────────
function renderSidebar() {
  const list  = document.getElementById('cafe-list');
  const msgEl = document.getElementById('sidebar-msg');
  msgEl.style.display = 'none';
  list.innerHTML = '';

  const filtered = getFiltered();

  // Show a note for amenity filters explaining the data source
  if (['wifi','pet','outdoor'].includes(activeFilter)) {
    const note = document.createElement('p');
    note.className = 'filter-note';
    note.textContent = '* Based on reviews & place info from Google';
    list.appendChild(note);
  }

  if (!filtered.length) {
    list.innerHTML += `<div class="no-results">😕 No cafes match this filter.<br><small>Try "All" or a different area.</small></div>`;
    return;
  }

  filtered.forEach(({ place, idx }) => {
    list.appendChild(buildCard(place, idx));
  });
}

// ── Build card ────────────────────────────────────────────────────
function buildCard(place, idx) {
  const emoji  = EMOJIS[idx % EMOJIS.length];
  const d      = detailsCache[place.place_id];
  const hours  = d?.opening_hours || place.opening_hours;
  const isOpen = hours?.isOpen?.();
  const rating = d?.rating ?? place.rating;
  const dist   = distText(place.geometry.location);

  const card = document.createElement('div');
  card.className = 'cafe-card';
  card.dataset.idx = idx;

  const openTag   = isOpen === true  ? `<span class="tag open">Open now</span>`
                  : isOpen === false ? `<span class="tag closed">Closed</span>` : '';
  const ratingTag = rating ? `<span class="tag amber">★ ${rating}</span>` : '';

  card.innerHTML = `
    <div class="cafe-card-top">
      <div class="cafe-emoji-box">${emoji}</div>
      <div class="cafe-card-info">
        <h3>${esc(place.name)}</h3>
        <p>${place.vicinity ? esc(trimAddr(place.vicinity)) : ''}${dist ? ' · ' + dist : ''}</p>
      </div>
    </div>
    <div class="cafe-card-meta">
      ${openTag}${ratingTag}
      ${quickTags(place, d)}
    </div>
  `;

  card.addEventListener('click', () => {
    selectIdx(idx);
    openDetail(place.place_id, idx);
  });

  return card;
}

// ── Quick tag pills on cards ──────────────────────────────────────
function quickTags(place, d) {
  const haystack = [
    place.name,
    ...(place.types || []),
    (d?.reviews || []).map(r => r.text).join(' '),
  ].join(' ').toLowerCase();

  let html = '';
  if (/wifi|wi-fi|internet/.test(haystack))          html += `<span class="tag">📶 Wi-Fi</span>`;
  if (/\bpet\b|dog-friendly|pet.friendly/.test(haystack)) html += `<span class="tag">🐾 Pets</span>`;
  if (/outdoor|terrace|garden|patio/.test(haystack)) html += `<span class="tag">🌿 Outdoor</span>`;
  if (/bakery|pastry|bak/.test(haystack))            html += `<span class="tag">🥐 Bakery</span>`;
  return html;
}

// ── Select / highlight a place ────────────────────────────────────
function selectIdx(idx) {
  if (activeCardEl) activeCardEl.classList.remove('active');
  const card = document.querySelector(`.cafe-card[data-idx="${idx}"]`);
  if (card) {
    card.classList.add('active');
    card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    activeCardEl = card;
  }
  const place = allPlaces[idx];
  if (place) { map.panTo(place.geometry.location); map.setZoom(16); }
  infoWindow.close();
}

// ── Open detail panel ─────────────────────────────────────────────
function openDetail(placeId, idx) {
  const panel   = document.getElementById('detail-panel');
  const content = document.getElementById('detail-content');
  const emoji   = EMOJIS[idx % EMOJIS.length];

  // Use cached or fetch fresh
  const render = (d) => {
    const isOpen  = d.opening_hours?.isOpen?.();
    const today   = (new Date().getDay() + 6) % 7; // Mon=0 for weekday_text
    const lat     = d.geometry.location.lat();
    const lng     = d.geometry.location.lng();
    const dirUrl  = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&destination_place_id=${placeId}`;
    const mapsUrl = `https://www.google.com/maps/place/?q=place_id:${placeId}`;

    const priceLabels = ['Free','Budget ₹','Moderate ₹₹','Pricey ₹₹₹','Luxury ₹₹₹₹'];
    const priceStr = d.price_level != null ? priceLabels[d.price_level] || '' : '';

    // Hours HTML
    let hoursHtml = '';
    if (d.opening_hours?.weekday_text?.length) {
      const rows = d.opening_hours.weekday_text.map((line, i) => {
        const [day, ...rest] = line.split(': ');
        return `<div class="hours-row ${i === today ? 'today' : ''}">
          <span class="hours-day">${day}</span>
          <span>${rest.join(': ')}</span>
        </div>`;
      }).join('');
      hoursHtml = `
        <div class="detail-section">
          <div class="detail-section-title">Opening Hours</div>
          <div class="hours-list">${rows}</div>
        </div>`;
    }

    // Contact HTML
    let contactHtml = '';
    if (d.formatted_phone_number || d.website) {
      contactHtml = `<div class="detail-section">
        <div class="detail-section-title">Contact</div>
        ${d.formatted_phone_number
          ? `<div class="detail-row"><span class="d-row-icon">📞</span><span>${esc(d.formatted_phone_number)}</span></div>` : ''}
        ${d.website
          ? `<div class="detail-row"><span class="d-row-icon">🌐</span><a href="${d.website}" target="_blank">${esc(d.website)}</a></div>` : ''}
      </div>`;
    }

    // Amenities (from reviews + types)
    const haystack = [
      d.name,
      ...(d.types || []),
      (d.reviews || []).map(r => r.text).join(' '),
    ].join(' ').toLowerCase();

    const amenities = [
      { label: 'Wi-Fi',        icon: '📶', test: /wifi|wi-fi|internet/ },
      { label: 'Pet Friendly', icon: '🐾', test: /\bpet\b|dog.friend|pet.friend/ },
      { label: 'Outdoor Seat', icon: '🌿', test: /outdoor|terrace|garden|patio/ },
      { label: 'Takeaway',     icon: '🥡', test: /takeaway|takeout|to.go/ },
      { label: 'Dine-in',     icon: '🍽️', test: /dine.in|eat.in|sit.in/ },
      { label: 'Bakery',      icon: '🥐', test: /bakery|pastry|cake/ },
    ];

    const amenHtml = amenities.map(a => {
      const has = a.test.test(haystack);
      return `<div class="amenity-item ${has ? 'yes' : 'no'}">
        <span>${a.icon}</span><span>${a.label}</span>
      </div>`;
    }).join('');

    content.innerHTML = `
      <div class="detail-hero">
        <div class="d-emoji">${emoji}</div>
        <div class="d-name">${esc(d.name)}</div>
        <div class="d-addr">${d.formatted_address ? esc(d.formatted_address) : ''}</div>
        <div class="d-badges">
          ${isOpen === true  ? '<span class="d-badge open">🟢 Open now</span>' : ''}
          ${isOpen === false ? '<span class="d-badge closed">🔴 Closed now</span>' : ''}
          ${d.rating ? `<span class="d-badge">★ ${d.rating} (${d.user_ratings_total || 0} reviews)</span>` : ''}
          ${priceStr ? `<span class="d-badge">${priceStr}</span>` : ''}
        </div>
      </div>

      ${hoursHtml}

      <div class="detail-section">
        <div class="detail-section-title">Amenities</div>
        <div class="amenities">${amenHtml}</div>
      </div>

      ${contactHtml}

      <a class="btn-directions" href="${dirUrl}" target="_blank">🧭 Get Directions</a>
      <a class="btn-gmaps" href="${mapsUrl}" target="_blank">🗺️ View on Google Maps</a>
    `;

    panel.classList.remove('hidden');
  };

  if (detailsCache[placeId]) {
    render(detailsCache[placeId]);
  } else {
    content.innerHTML = `<div style="padding:40px;text-align:center;color:#aaa;font-size:13px">Loading details...</div>`;
    panel.classList.remove('hidden');
    svc.getDetails(
      {
        placeId,
        fields: [
          'place_id','name','formatted_address','formatted_phone_number',
          'opening_hours','rating','user_ratings_total',
          'website','price_level','reviews','geometry','types',
        ],
      },
      (d, status) => {
        if (status === google.maps.places.PlacesServiceStatus.OK) {
          detailsCache[placeId] = d;
          render(d);
        }
      }
    );
  }
}

function closeDetail() {
  document.getElementById('detail-panel').classList.add('hidden');
}

// ── Markers ───────────────────────────────────────────────────────
function addMarker(place, idx) {
  const emoji = EMOJIS[idx % EMOJIS.length];
  const marker = new google.maps.Marker({
    map,
    position: place.geometry.location,
    title: place.name,
    icon: {
      url: pinSvg(emoji),
      scaledSize: new google.maps.Size(42, 42),
      anchor: new google.maps.Point(21, 42),
    },
  });
  marker.addListener('click', () => {
    selectIdx(idx);
    openDetail(place.place_id, idx);
  });
  markers[idx] = marker;
}

// sync marker visibility with active filter
function syncMarkers() {
  const visible = new Set(getFiltered().map(f => f.idx));
  markers.forEach((m, i) => { if (m) m.setMap(visible.has(i) ? map : null); });
}

function pinSvg(emoji) {
  const s = `<svg xmlns="http://www.w3.org/2000/svg" width="42" height="42" viewBox="0 0 42 42">
    <circle cx="21" cy="18" r="16" fill="#D4537E" stroke="#fff" stroke-width="2.5"/>
    <text x="21" y="23" text-anchor="middle" font-size="16">${emoji}</text>
    <polygon points="16,31 26,31 21,42" fill="#D4537E"/>
  </svg>`;
  return 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(s);
}

// ── Skeleton loading ──────────────────────────────────────────────
function showSkeleton() {
  const list = document.getElementById('cafe-list');
  document.getElementById('sidebar-msg').style.display = 'none';
  list.innerHTML = Array(6).fill(0).map(() => `
    <div class="skeleton-card">
      <div class="skel skel-box"></div>
      <div class="skel-lines">
        <div class="skel skel-line" style="width:70%"></div>
        <div class="skel skel-line" style="width:50%"></div>
        <div class="skel skel-line" style="width:40%"></div>
      </div>
    </div>`).join('');
}

function showMsg(icon, title, sub = '') {
  document.getElementById('cafe-list').innerHTML = '';
  const el = document.getElementById('sidebar-msg');
  el.style.display = 'flex';
  el.innerHTML = `<div class="msg-icon">${icon}</div>
    <p class="msg-title">${title}</p>
    ${sub ? `<p class="msg-sub">${sub}</p>` : ''}`;
}

// ── Helpers ───────────────────────────────────────────────────────
function clearAll() {
  markers.forEach(m => m && m.setMap(null));
  markers = [];
  allPlaces = [];
  detailsCache = {};
  activeCardEl = null;
  infoWindow.close();
  closeDetail();
  document.getElementById('cafe-list').innerHTML = '';
}

function setStatus(msg) {
  document.getElementById('status-text').textContent = msg;
}

function esc(s) {
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function trimAddr(addr) {
  // Show first two comma-parts max
  return addr.split(',').slice(0, 2).join(',');
}

function distText(latLng) {
  const c = map.getCenter();
  if (!c) return '';
  const R = 6371000;
  const φ1 = c.lat()*Math.PI/180, φ2 = latLng.lat()*Math.PI/180;
  const dφ = (latLng.lat()-c.lat())*Math.PI/180;
  const dλ = (latLng.lng()-c.lng())*Math.PI/180;
  const a  = Math.sin(dφ/2)**2 + Math.cos(φ1)*Math.cos(φ2)*Math.sin(dλ/2)**2;
  const d  = R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
  return d < 1000 ? `${Math.round(d)} m` : `${(d/1000).toFixed(1)} km`;
}

// ── Pastel map styles ─────────────────────────────────────────────
function mapStyles() {
  return [
    { featureType:'water',       elementType:'geometry',          stylers:[{color:'#f8c8d8'}] },
    { featureType:'road',        elementType:'geometry.fill',     stylers:[{color:'#ffffff'}] },
    { featureType:'road',        elementType:'geometry.stroke',   stylers:[{color:'#f4c0d1'}] },
    { featureType:'road.highway',elementType:'geometry.fill',     stylers:[{color:'#fbeaf0'}] },
    { featureType:'poi.park',    elementType:'geometry',          stylers:[{color:'#d4eabf'}] },
    { featureType:'landscape',   elementType:'geometry',          stylers:[{color:'#fdf5f8'}] },
    { featureType:'transit',     elementType:'geometry',          stylers:[{color:'#f4c0d1'}] },
    { featureType:'poi',         elementType:'labels',            stylers:[{visibility:'off'}] },
    { featureType:'road',        elementType:'labels.text.fill',  stylers:[{color:'#c49baa'}] },
  ];
}