// ===== Map: Leaflet initialization, markers, card, interactions =====

const MapModule = (() => {
  let map = null;
  let markers = {};        // merchantId -> { marker, element }
  let clusterGroup = null;
  let activeMarkerId = null;
  let hoverTimeout = null;
  let cardHideTimeout = null;

  const CENTER = [41.3594, 2.1056];
  const ZOOM_INITIAL = 13;
  const ZOOM_MIN = 12;
  const ZOOM_MAX = 18;

  /**
   * Initialize the Leaflet map.
   */
  function init() {
    map = L.map('map', {
      zoomControl: true,
      minZoom: ZOOM_MIN,
      maxZoom: ZOOM_MAX
    }).setView(CENTER, ZOOM_INITIAL);

    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>',
      subdomains: 'abcd',
      maxZoom: 20
    }).addTo(map);

    // Click on empty map area -> reset
    map.on('click', () => {
      resetAllStates();
      App.closeModal();
    });

    clusterGroup = L.markerClusterGroup({
      maxClusterRadius: 30,
      spiderfyOnMaxZoom: true,
      showCoverageOnHover: false,
      disableClusteringAtZoom: 16,
      iconCreateFunction: (cluster) => {
        const count = cluster.getChildCount();
        return L.divIcon({
          html: `<div>${count}</div>`,
          className: 'marker-cluster',
          iconSize: L.point(44, 44)
        });
      }
    });

    map.addLayer(clusterGroup);

    // Cluster hover -> show tooltip with merchant list
    clusterGroup.on('clustermouseover', (e) => {
      const cluster = e.layer;
      const childMarkers = cluster.getAllChildMarkers();
      const now = new Date();

      // Build merchant info from child markers
      const lines = childMarkers.map(cm => {
        const latlng = cm.getLatLng();
        const merchant = findMerchantByLatLng(latlng);
        if (!merchant) return null;
        const status = Signals.getOpenStatus(merchant, now);
        const dotClass = (status.status === 'open' || status.status === 'closing-soon') ? 'dot-open' : 'dot-closed';
        return `<div class="cluster-tooltip-item"><span class="status-dot ${dotClass}"></span>${merchant.name}</div>`;
      }).filter(Boolean);

      const html = `
        <div class="cluster-tooltip-header">${childMarkers.length} comerciants</div>
        ${lines.join('')}
        <div class="cluster-tooltip-footer">Clic per expandir</div>
      `;

      cluster.bindTooltip(html, {
        className: 'cluster-tooltip',
        direction: 'top',
        offset: [0, -20],
        opacity: 1
      }).openTooltip();
    });

    clusterGroup.on('clustermouseout', (e) => {
      e.layer.unbindTooltip();
    });
  }

  /**
   * Find merchant by marker latlng.
   */
  function findMerchantByLatLng(latlng) {
    return App.merchants.find(m =>
      m.coordinates.lat === latlng.lat && m.coordinates.lng === latlng.lng
    );
  }

  /**
   * Create a custom div marker for a merchant.
   */
  function createMarker(merchant, eventColor) {
    const { classes, status, popularity } = Signals.getMarkerClasses(merchant);

    // Skip merchants with no coordinates
    if (!merchant.coordinates || (merchant.coordinates.lat === 0 && merchant.coordinates.lng === 0)) {
      return null;
    }

    const colorStyle = eventColor ? `style="--event-color:${eventColor}"` : '';
    const markerHtml = `<div class="custom-marker ${classes.join(' ')}" data-merchant-id="${merchant.id}" ${colorStyle}>${merchant.id}</div>`;

    const icon = L.divIcon({
      html: markerHtml,
      className: 'custom-marker-wrapper',
      iconSize: [36, 36],
      iconAnchor: [18, 18]
    });

    const marker = L.marker([merchant.coordinates.lat, merchant.coordinates.lng], { icon });

    // Store reference
    markers[merchant.id] = { marker, status, popularity };

    // Marker hover -> show card
    marker.on('mouseover', () => {
      clearTimeout(cardHideTimeout);
      hoverTimeout = setTimeout(() => {
        showCard(merchant, marker);
        highlightListItem(merchant.id);
        updateMarkerElement(merchant.id, 'add', 'marker-hover');
      }, 200);
    });

    marker.on('mouseout', () => {
      clearTimeout(hoverTimeout);
      cardHideTimeout = setTimeout(() => {
        hideCard();
      }, 200);
      updateMarkerElement(merchant.id, 'remove', 'marker-hover');
      unhighlightListItem();
    });

    // Marker click -> open modal
    marker.on('click', (e) => {
      L.DomEvent.stopPropagation(e);
      setActive(merchant.id);
      App.setActiveItem(merchant.id);
      panTo(merchant.id, true);
      App.openModal(merchant);
    });

    clusterGroup.addLayer(marker);
    return marker;
  }

  /**
   * Add all merchants to the map with optional event color.
   */
  function addMerchants(merchantList, eventColor) {
    merchantList.forEach(m => createMarker(m, eventColor));
  }

  /**
   * Fit map to the bounds of all current markers with padding.
   */
  function fitToMarkers() {
    const bounds = clusterGroup.getBounds();
    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [40, 40] });
    }
  }

  /**
   * Pan map to a merchant with smooth animation.
   * If offsetForModal is true, shifts center left to account for the 400px modal panel on the right.
   */
  function panTo(merchantId, offsetForModal = false) {
    const entry = markers[merchantId];
    if (!entry) return;
    const latlng = entry.marker.getLatLng();
    const zoom = Math.max(map.getZoom(), 16);

    if (offsetForModal) {
      const targetPoint = map.project(latlng, zoom);
      // Shift left by half the modal width so the marker stays in the visible area center
      targetPoint.x += 200;
      const offsetLatLng = map.unproject(targetPoint, zoom);
      map.flyTo(offsetLatLng, zoom, { duration: 0.5 });
    } else {
      map.flyTo(latlng, zoom, { duration: 0.5 });
    }
  }

  /**
   * Set a marker as active, dim others.
   */
  function setActive(merchantId) {
    // Reset previous
    resetMarkerStates();
    activeMarkerId = merchantId;

    Object.keys(markers).forEach(id => {
      const numId = Number(id);
      if (numId === merchantId) {
        updateMarkerElement(numId, 'add', 'marker-active');
        updateMarkerElement(numId, 'remove', 'marker-out-of-focus');
      } else {
        updateMarkerElement(numId, 'add', 'marker-out-of-focus');
        updateMarkerElement(numId, 'remove', 'marker-active');
      }
    });
  }

  /**
   * Reset all marker states to default.
   */
  function resetMarkerStates() {
    activeMarkerId = null;
    Object.keys(markers).forEach(id => {
      updateMarkerElement(Number(id), 'remove', 'marker-active');
      updateMarkerElement(Number(id), 'remove', 'marker-out-of-focus');
      updateMarkerElement(Number(id), 'remove', 'marker-hover');
    });
  }

  /**
   * Reset all states (markers + list).
   */
  function resetAllStates() {
    resetMarkerStates();
    hideCard();
    App.resetListStates();
  }

  /**
   * Trigger bounce animation on a marker (from list hover).
   */
  function bounceMarker(merchantId) {
    const el = getMarkerDomElement(merchantId);
    if (!el) return;
    el.classList.remove('bouncing');
    // Force reflow to restart animation
    void el.offsetWidth;
    el.classList.add('bouncing');
    el.addEventListener('animationend', () => {
      el.classList.remove('bouncing');
    }, { once: true });
  }

  /**
   * Show the expanded card near a marker.
   */
  function showCard(merchant, marker) {
    const card = document.getElementById('merchant-card');
    const now = new Date();
    const status = Signals.getOpenStatus(merchant, now);
    const popularity = Signals.getPopularity(merchant.stats.visits);

    // Photo
    const photoEl = document.getElementById('card-photo');
    photoEl.innerHTML = `<img src="assets/images/merchants/${merchant.id}.png" alt="${merchant.name}" class="card-photo-img" onerror="this.parentElement.style.display='none'">`;
    photoEl.style.display = '';

    // Fill card content
    const badgeEl = document.getElementById('card-badge');
    if (popularity.icon) {
      badgeEl.innerHTML = `<span class="merchant-popular-badge">${popularity.level === 'very-popular' ? 'Molt popular' : 'Popular'}</span>`;
    } else {
      badgeEl.innerHTML = '';
    }
    document.getElementById('card-name').textContent = merchant.name;
    document.getElementById('card-dish').textContent = merchant.dish.name + (merchant.dish.price ? ' · ' + merchant.dish.price : '');
    document.getElementById('card-address').innerHTML = `<i data-lucide="map-pin" class="lucide-sm"></i> ${merchant.address}`;
    lucide.createIcons({ attrs: { class: 'lucide-sm' }, nameAttr: 'data-lucide' });
    const statusEl = document.getElementById('card-status');
    statusEl.innerHTML = Signals.getStatusBadge(status);
    statusEl.className = `card-status ${status.status}`;

    // Tags
    const tagsEl = document.getElementById('card-tags');
    tagsEl.innerHTML = merchant.tags.map(t =>
      `<span class="card-tag">${Signals.getTagLabel(t)}</span>`
    ).join('');

    // Buttons
    document.getElementById('card-btn-route').onclick = (e) => {
      e.stopPropagation();
      openRoute(merchant);
    };
    document.getElementById('card-btn-detail').onclick = (e) => {
      e.stopPropagation();
      hideCard();
      panTo(merchant.id, true);
      App.openModal(merchant);
    };

    // Position card above marker
    const containerPt = map.latLngToContainerPoint(marker.getLatLng());
    positionCard(card, containerPt.x, containerPt.y);

    card.classList.remove('hidden');
    card.classList.add('visible');

    // Keep card visible when hovering on it
    card.onmouseenter = () => clearTimeout(cardHideTimeout);
    card.onmouseleave = () => {
      cardHideTimeout = setTimeout(() => hideCard(), 200);
    };
  }

  /**
   * Position the card in the map container.
   */
  function positionCard(card, x, y) {
    const mapContainer = document.getElementById('map-container');
    const mapRect = mapContainer.getBoundingClientRect();

    // Convert map-relative coords to map-container-relative
    const cardW = 300;
    const cardH = card.offsetHeight || 280;

    let left = x - cardW / 2;
    let top = y - cardH - 28; // 28px above marker

    // Clamp to viewport
    if (left < 8) left = 8;
    if (left + cardW > mapRect.width - 8) left = mapRect.width - cardW - 8;
    if (top < 8) top = y + 28; // Show below if no room above

    card.style.left = `${mapRect.left + left}px`;
    card.style.top = `${mapRect.top + top}px`;
  }

  /**
   * Hide the expanded card.
   */
  function hideCard() {
    const card = document.getElementById('merchant-card');
    card.classList.remove('visible');
    card.classList.add('hidden');
  }

  /**
   * Open Google Maps route.
   */
  function openRoute(merchant) {
    const { lat, lng } = merchant.coordinates;
    window.open(
      `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`,
      '_blank'
    );
  }

  /**
   * Scroll list to show a merchant item.
   */
  function scrollListToItem(merchantId) {
    const item = document.querySelector(`.merchant-item[data-id="${merchantId}"]`);
    if (!item) return;

    item.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  /**
   * Highlight corresponding list item when hovering marker.
   */
  function highlightListItem(merchantId) {
    scrollListToItem(merchantId);

    // Highlight the item
    document.querySelectorAll('.merchant-item').forEach(el => el.classList.remove('hover-from-map'));
    const item = document.querySelector(`.merchant-item[data-id="${merchantId}"]`);
    if (item) item.classList.add('hover-from-map');
  }

  /**
   * Remove list highlight.
   */
  function unhighlightListItem() {
    document.querySelectorAll('.merchant-item.hover-from-map').forEach(el =>
      el.classList.remove('hover-from-map')
    );
  }

  /**
   * Get DOM element for a marker by merchant id.
   */
  function getMarkerDomElement(merchantId) {
    return document.querySelector(`.custom-marker[data-merchant-id="${merchantId}"]`);
  }

  /**
   * Update CSS class on marker DOM element.
   */
  function updateMarkerElement(merchantId, action, className) {
    const el = getMarkerDomElement(merchantId);
    if (!el) return;
    if (action === 'add') el.classList.add(className);
    else el.classList.remove(className);
  }

  /**
   * Update markers based on current time (for open/closed changes).
   */
  function refreshMarkerStates(merchantList) {
    const now = new Date();
    merchantList.forEach(m => {
      const el = getMarkerDomElement(m.id);
      if (!el) return;
      const { classes } = Signals.getMarkerClasses(m, now);

      // Remove old status classes
      el.classList.remove('marker-open', 'marker-closed', 'marker-opening-soon', 'marker-closing-soon',
        'pulse', 'pulse-fast', 'pulse-intense', 'glow');

      // Apply new
      classes.forEach(c => el.classList.add(c));
    });
  }

  /**
   * Trigger a ripple effect on a marker.
   */
  function triggerRipple(merchantId) {
    const el = getMarkerDomElement(merchantId);
    if (!el) return;

    const ripple = document.createElement('div');
    ripple.className = 'ripple-ring';
    el.appendChild(ripple);

    ripple.addEventListener('animationend', () => ripple.remove());
  }

  /**
   * Public wrapper: show card for a merchant by id (used from list hover).
   */
  function showCardForMerchant(merchantId, merchant) {
    const entry = markers[merchantId];
    if (!entry) return;
    clearTimeout(cardHideTimeout);
    showCard(merchant, entry.marker);
    updateMarkerElement(merchantId, 'add', 'marker-hover');
  }

  /**
   * Public wrapper: hide card and clean up hover state (used from list mouseleave).
   */
  function hideCardAndHover(merchantId) {
    cardHideTimeout = setTimeout(() => hideCard(), 200);
    if (merchantId) updateMarkerElement(merchantId, 'remove', 'marker-hover');
  }

  // ---- Influence Zone (Buffer + Union via Turf.js) ----

  let zoneLayers = [];

  /**
   * Draw influence zone as merged buffers around each merchant.
   * Uses Turf.js for buffer + union operations.
   */
  function drawInfluenceZone(merchantList, color) {
    if (typeof turf === 'undefined') return;

    const points = merchantList
      .filter(m => m.coordinates && !(m.coordinates.lat === 0 && m.coordinates.lng === 0))
      .map(m => turf.point([m.coordinates.lng, m.coordinates.lat]));

    if (points.length === 0) return;

    // Buffer each point (radius in km)
    const radius = 0.25; // 250m
    const buffers = points.map(p => turf.buffer(p, radius, { units: 'kilometers', steps: 32 }));

    // Merge all overlapping buffers into one shape
    let merged = buffers[0];
    for (let i = 1; i < buffers.length; i++) {
      try {
        merged = turf.union(turf.featureCollection([merged, buffers[i]]));
      } catch (e) {
        // If union fails for a point, skip it
      }
    }

    if (!merged) return;

    // Draw on map
    const layer = L.geoJSON(merged, {
      style: {
        color: color,
        weight: 2,
        opacity: 0.35,
        fillColor: color,
        fillOpacity: 0.08,
        interactive: false
      }
    });

    layer.addTo(map);
    zoneLayers.push(layer);
  }

  return {
    init,
    addMerchants,
    fitToMarkers,
    panTo,
    setActive,
    resetAllStates,
    bounceMarker,
    hideCard,
    showCardForMerchant,
    hideCardAndHover,
    openRoute,
    refreshMarkerStates,
    triggerRipple,
    drawInfluenceZone,
    get activeMarkerId() { return activeMarkerId; },
    get markers() { return markers; }
  };
})();
