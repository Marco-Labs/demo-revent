// ===== AppFesta: Festa Major app renderer =====
// Compatible with the App interface expected by map.js.

const AppFesta = (() => {
  let allActs   = [];
  let venueMap  = {};   // venue_id -> venue object
  let activeActId = null;

  // ---- Initialization ----

  async function init() {
    // Make map.js happy: it calls App.merchants, App.closeModal, etc.
    window.App = AppFesta;

    try {
      const data = await loadData();
      venueMap = {};
      data.venues.forEach(v => { venueMap[v.id] = v; });

      // Preprocess acts: attach venue info + map.js compatibility fields
      allActs = data.acts.map((act, i) => {
        const venue = venueMap[act.venue_id];
        // Spread acts at the same venue in a small circle (prevents exact overlap)
        const angle  = i * 0.8; // radians
        const spread = 0.00006;
        const coords = venue
          ? { lat: venue.coordinates.lat + spread * Math.sin(angle),
              lng: venue.coordinates.lng + spread * Math.cos(angle) }
          : { lat: 0, lng: 0 };

        return {
          ...act,
          coordinates:   coords,
          venue_name:    venue ? venue.name    : act.venue_id,
          venue_address: venue ? venue.address : '',
          // map.js showCard compatibility
          address: venue ? venue.address : '',
          dish:    { name: act.description || '', price: act.free ? 'Gratuït' : '' },
          tags:    act.tags || [],
          stats:   { visits: act.expected_attendance || 60, routes: 0 },
        };
      });

      MapModule.init();
      MapModule.addMerchants(allActs, data.meta.color);
      MapModule.drawInfluenceZone(allActs, data.meta.color);
      MapModule.fitToMarkers({ maxZoom: 16 });
      MapModule.updateLabelVisibility();

      renderHeader(data.meta, data.stats);
      renderDaySections();
      lucide.createIcons();
      updateNowCount();
      startLiveCounters();
      startRippleLoop();

      document.getElementById('map-loading').classList.add('hidden');
    } catch (err) {
      console.error('AppFesta error:', err);
      const el = document.getElementById('map-loading');
      el.classList.add('error');
      el.querySelector('p').textContent = 'Error carregant les dades.';
    }
  }

  async function loadData() {
    const resp = await fetch('assets/data/hostafrancs-2023.json');
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return resp.json();
  }

  // ---- Header ----

  function renderHeader(meta, stats) {
    // Swap logo for Barcelona city council
    const logo = document.querySelector('.header-logo');
    if (logo) {
      logo.src = 'assets/images/ajuntament-300x105.jpg';
      logo.alt = 'Ajuntament de Barcelona';
    }

    document.getElementById('header-subtitle').textContent = meta.hashtag;
    document.getElementById('visits-count').textContent =
      stats.total_visits_today.toLocaleString('ca-ES');

    // Rename "establiments oberts" → "actes ara mateix"
    const openRow = document.querySelector('.stat-row:last-child');
    if (openRow) {
      const label = openRow.querySelector('span:last-child');
      if (label) label.innerHTML = '<strong id="open-count">0</strong> actes ara mateix';
    }

    // Hide promotor panel link (not relevant for this demo)
    const link = document.getElementById('link-municipio');
    if (link) link.style.display = 'none';
  }

  // ---- Day Sections ----

  function renderDaySections() {
    const container = document.getElementById('merchant-list');
    const now       = new Date();
    const offsets   = SignalsFesta.getDayOffsets(allActs);

    container.innerHTML = offsets.map((offset) => {
      const dayActs = allActs
        .filter(a => a.day_offset === offset)
        .sort((a, b) => a.time.localeCompare(b.time));

      const happeningCount = dayActs.filter(a => {
        const s = SignalsFesta.getActStatus(a, now);
        return s.status === 'happening-now' || s.status === 'ending-soon';
      }).length;

      const nowBadge = happeningCount > 0
        ? `<span class="happening-now-badge">${happeningCount} ara</span>`
        : '';

      const actsHtml = dayActs.map(act => {
        const status   = SignalsFesta.getActStatus(act, now);
        const typeIcon = SignalsFesta.getTypeIcon(act.type);
        return `
          <div class="merchant-item act-item" data-id="${act.id}">
            <div class="act-item-row">
              <span class="act-time">${act.time}</span>
              <div class="act-item-info">
                <div class="act-name-row">
                  <span class="act-type-icon">${typeIcon}</span>
                  <span class="merchant-name">${act.name}</span>
                </div>
                <p class="merchant-address">
                  <i data-lucide="map-pin" class="lucide-sm"></i> ${act.venue_name}
                </p>
                <p class="merchant-status ${status.status}">
                  ${SignalsFesta.getStatusBadge(status)}
                </p>
              </div>
            </div>
          </div>`;
      }).join('');

      // Only expand today; collapse the rest
      const collapsed = offset === 0 ? '' : 'collapsed';

      return `
        <div class="event-section" data-offset="${offset}">
          <div class="event-section-header">
            <div class="event-section-info">
              <span class="event-section-name">${SignalsFesta.getDayTitle(offset)}</span>
              <span class="event-section-meta">${dayActs.length} actes${nowBadge ? ' · ' + nowBadge : ''}</span>
            </div>
            <span class="event-section-toggle">${collapsed ? '▸' : '▾'}</span>
          </div>
          <div class="event-section-body ${collapsed}">
            ${actsHtml}
          </div>
        </div>`;
    }).join('');

    // Section toggle
    container.querySelectorAll('.event-section-header').forEach(header => {
      header.addEventListener('click', () => {
        const body   = header.nextElementSibling;
        const toggle = header.querySelector('.event-section-toggle');
        body.classList.toggle('collapsed');
        toggle.textContent = body.classList.contains('collapsed') ? '▸' : '▾';
        MapModule.updateLabelVisibility();
      });
    });

    // Act item interactions
    container.querySelectorAll('.act-item').forEach(item => {
      const id = Number(item.dataset.id);

      item.addEventListener('click', e => {
        e.stopPropagation();
        const act = allActs.find(a => a.id === id);
        setActiveItem(id);
        MapModule.panTo(id, true);
        MapModule.setActive(id);
        if (act) openModal(act);
      });

      item.addEventListener('mouseenter', () => {
        if (activeActId === null) {
          const act = allActs.find(a => a.id === id);
          MapModule.bounceMarker(id);
          MapModule.showCardForMerchant(id, act);
        }
      });

      item.addEventListener('mouseleave', () => {
        if (activeActId === null) MapModule.hideCardAndHover(id);
      });
    });
  }

  // ---- List state ----

  function setActiveItem(actId) {
    activeActId = actId;
    document.querySelectorAll('.merchant-item').forEach(item => {
      const id = Number(item.dataset.id);
      item.classList.remove('active', 'out-of-focus');
      if (id === actId) item.classList.add('active');
      else              item.classList.add('out-of-focus');
    });
    MapModule.hideCard();
  }

  function resetListStates() {
    activeActId = null;
    document.querySelectorAll('.merchant-item').forEach(item =>
      item.classList.remove('active', 'out-of-focus')
    );
  }

  // ---- Stats ----

  function updateNowCount() {
    const count = SignalsFesta.countHappeningNow(allActs);
    const el = document.getElementById('open-count');
    if (el) el.textContent = count;
  }

  // ---- Modal ----

  function openModal(act) {
    const now      = new Date();
    const status   = SignalsFesta.getActStatus(act, now);
    const typeIcon = SignalsFesta.getTypeIcon(act.type);
    const end      = SignalsFesta.getActEndDatetime(act);
    const endStr   = `${end.getHours()}:${String(end.getMinutes()).padStart(2,'0')}h`;

    // Photo area → styled icon placeholder
    document.getElementById('modal-photo').innerHTML =
      `<div class="festa-act-photo">
        <span class="festa-act-icon">${typeIcon}</span>
      </div>`;

    // Event badge
    const badge = document.getElementById('modal-event-badge');
    if (badge) badge.innerHTML =
      `<span class="modal-event-tag" style="background:#C0392B">🎉 Festa Major d'Hostafrancs</span>`;

    document.getElementById('modal-name').textContent = act.name;
    document.getElementById('modal-dish').textContent = act.description || '';
    document.getElementById('modal-dish-desc').textContent =
      act.organizer ? `Organitza: ${act.organizer}` : '';

    document.getElementById('modal-address').innerHTML =
      `<i data-lucide="map-pin" class="lucide-sm"></i> ${act.venue_name} · ${act.venue_address}`;

    const statusEl = document.getElementById('modal-status');
    statusEl.innerHTML   = SignalsFesta.getStatusBadge(status);
    statusEl.className   = `modal-status ${status.status}`;

    document.getElementById('modal-hours').innerHTML = `
      <div class="act-modal-time">
        <i data-lucide="clock" class="lucide-sm"></i>
        <strong>${SignalsFesta.getDayLabel(act.day_offset)}</strong>
        · ${act.time} – ${endStr}
        ${act.free !== false ? '<span class="act-free-badge">Gratuït</span>' : ''}
      </div>`;

    document.getElementById('modal-tags').innerHTML = (act.tags || []).map(t =>
      `<span class="modal-tag">${t}</span>`
    ).join('');

    document.getElementById('modal-btn-route').onclick = () => {
      const venue = venueMap[act.venue_id];
      if (venue) MapModule.openRoute({ coordinates: venue.coordinates });
    };

    // Hide "Panel del comerciant" (irrelevant for festa)
    const statsBtn = document.getElementById('modal-btn-stats');
    if (statsBtn) statsBtn.style.display = 'none';

    const overlay = document.getElementById('modal-overlay');
    overlay.classList.remove('hidden');
    lucide.createIcons();

    document.getElementById('modal-close').onclick = closeModal;
    document.getElementById('modal-back').onclick  = closeModal;
    overlay.onclick = e => { if (e.target === overlay) closeModal(); };
  }

  function closeModal() {
    document.getElementById('modal-overlay').classList.add('hidden');
    resetListStates();
    MapModule.resetAllStates();
  }

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeModal();
  });

  // ---- Live counters ----

  function startLiveCounters() {
    let explorers = 14;
    setInterval(() => {
      const delta = Math.random() > 0.5 ? 1 : -1;
      explorers = Math.max(5, Math.min(30, explorers + delta));
      const el = document.getElementById('explorers-count');
      el.style.opacity = '0';
      setTimeout(() => { el.textContent = explorers; el.style.opacity = '1'; }, 150);
    }, 4000);

    setInterval(updateNowCount, 60000);
    setInterval(() => {
      MapModule.refreshMarkerStates(allActs);
      updateListStatuses();
    }, 60000);
  }

  function updateListStatuses() {
    const now = new Date();
    document.querySelectorAll('.act-item').forEach(item => {
      const id  = Number(item.dataset.id);
      const act = allActs.find(a => a.id === id);
      if (!act) return;
      const status   = SignalsFesta.getActStatus(act, now);
      const statusEl = item.querySelector('.merchant-status');
      statusEl.className = `merchant-status ${status.status}`;
      statusEl.innerHTML = SignalsFesta.getStatusBadge(status);
    });
  }

  // ---- Ripple loop ----

  function startRippleLoop() {
    function doRipple() {
      const now    = new Date();
      const active = allActs.filter(a => SignalsFesta.getActStatus(a, now).status === 'happening-now');
      if (!active.length) return;
      const rand = active[Math.floor(Math.random() * active.length)];
      MapModule.triggerRipple(rand.id);
    }
    setInterval(() => setTimeout(doRipple, 2000 + Math.random() * 4000), 7000);
  }

  // ---- Public API (map.js interface) ----

  return {
    init,
    openModal,
    closeModal,
    resetListStates,
    setActiveItem,
    get merchants() { return allActs; },
    getEventForMerchant() { return null; },
  };
})();
