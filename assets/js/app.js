// ===== App: Main orchestration (multi-event) =====

const App = (() => {
  let events = [];
  let allMerchants = [];   // flat list of all merchants across events
  let merchantEventMap = {}; // merchantId -> event object
  let activeMerchantId = null;

  // ---- Initialization ----

  async function init() {
    try {
      const data = await loadData();
      events = data.events;

      // Build flat merchant list and event lookup
      events.forEach(evt => {
        evt.merchants.forEach(m => {
          m._event = evt; // back-reference
          allMerchants.push(m);
          merchantEventMap[m.id] = evt;
        });
      });

      MapModule.init();
      events.forEach(evt => {
        MapModule.addMerchants(evt.merchants, evt.color);
        MapModule.drawInfluenceZone(evt.merchants, evt.color);
      });

      renderGlobalStats(data);
      renderEventSections(events);
      updateOpenCount();
      startLiveCounters();
      startRippleLoop();

      // Hide loading
      document.getElementById('map-loading').classList.add('hidden');
    } catch (err) {
      console.error('Error loading data:', err);
      const loading = document.getElementById('map-loading');
      loading.classList.add('error');
      loading.querySelector('p').textContent = 'Error carregant les dades. Torna-ho a intentar.';
    }
  }

  async function loadData() {
    const resp = await fetch('assets/data/merchants.json');
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return resp.json();
  }

  // ---- Global Stats ----

  function renderGlobalStats(data) {
    document.getElementById('visits-count').textContent =
      data.meta.total_visits_today.toLocaleString('ca-ES');
  }

  // ---- Event Sections in Sidebar ----

  function renderEventSections(eventList) {
    const container = document.getElementById('merchant-list');
    const now = new Date();

    container.innerHTML = eventList.map((evt, idx) => {
      const openCount = Signals.countOpen(evt.merchants, now);
      const merchantsHtml = evt.merchants.map(m => {
        const status = Signals.getOpenStatus(m, now);
        const popularity = Signals.getPopularity(m.stats.visits);
        const popularBadge = popularity.icon
          ? `<span class="merchant-popular-badge">${popularity.icon} ${popularity.level === 'very-popular' ? 'Molt popular' : 'Popular'}</span>`
          : '';

        return `
          <div class="merchant-item" data-id="${m.id}" data-event="${evt.id}">
            <div class="merchant-item-row">
              <img src="assets/images/merchants/${m.id}.png" alt="${m.name}" class="merchant-thumb" onerror="this.style.display='none'">
              <div class="merchant-item-info">
                <div class="merchant-name-row">
                  <span class="merchant-number" style="background:${evt.color}">${m.id}</span>
                  <span class="merchant-name">${m.name}</span>
                  ${popularBadge}
                </div>
                <p class="merchant-dish">${m.dish.name}${m.dish.price ? ' · ' + m.dish.price : ''}</p>
                <p class="merchant-address">${m.address}</p>
                <p class="merchant-status ${status.status}">${Signals.getStatusBadge(status)}</p>
              </div>
            </div>
          </div>
        `;
      }).join('');

      return `
        <div class="event-section" data-event="${evt.id}">
          <div class="event-section-header" data-event="${evt.id}">
            <div class="event-section-color" style="background:${evt.color}"></div>
            <span class="event-section-icon">${evt.icon}</span>
            <div class="event-section-info">
              <span class="event-section-name">${evt.name}</span>
              <span class="event-section-meta">${evt.merchants.length} participants · ${openCount} oberts</span>
            </div>
            <span class="event-section-toggle">▾</span>
          </div>
          <div class="event-section-body ${idx === 0 ? '' : 'collapsed'}">
            ${merchantsHtml}
          </div>
        </div>
      `;
    }).join('');

    // Toggle collapse
    container.querySelectorAll('.event-section-header').forEach(header => {
      header.addEventListener('click', (e) => {
        const body = header.nextElementSibling;
        const toggle = header.querySelector('.event-section-toggle');
        body.classList.toggle('collapsed');
        toggle.textContent = body.classList.contains('collapsed') ? '▸' : '▾';
      });
    });

    // Merchant interactions
    container.querySelectorAll('.merchant-item').forEach(item => {
      const id = Number(item.dataset.id);

      item.addEventListener('click', (e) => {
        e.stopPropagation();
        const merchant = allMerchants.find(m => m.id === id);
        setActiveItem(id);
        MapModule.panTo(id, true);
        MapModule.setActive(id);
        if (merchant) openModal(merchant);
      });

      item.addEventListener('mouseenter', () => {
        if (activeMerchantId === null) {
          const merchant = allMerchants.find(m => m.id === id);
          MapModule.bounceMarker(id);
          MapModule.showCardForMerchant(id, merchant);
        }
      });

      item.addEventListener('mouseleave', () => {
        if (activeMerchantId === null) {
          MapModule.hideCardAndHover(id);
        }
      });
    });
  }

  /**
   * Set a list item as active, dim others.
   */
  function setActiveItem(merchantId) {
    activeMerchantId = merchantId;

    document.querySelectorAll('.merchant-item').forEach(item => {
      const id = Number(item.dataset.id);
      item.classList.remove('active', 'out-of-focus');
      if (id === merchantId) {
        item.classList.add('active');
      } else {
        item.classList.add('out-of-focus');
      }
    });

    MapModule.hideCard();
  }

  /**
   * Reset all list items to default state.
   */
  function resetListStates() {
    activeMerchantId = null;
    document.querySelectorAll('.merchant-item').forEach(item => {
      item.classList.remove('active', 'out-of-focus');
    });
  }

  // ---- Live Counters ----

  function startLiveCounters() {
    let explorers = 8;

    setInterval(() => {
      const change = Math.random() > 0.5 ? 1 : -1;
      explorers = Math.max(3, Math.min(15, explorers + change));
      const el = document.getElementById('explorers-count');
      el.style.opacity = '0';
      setTimeout(() => {
        el.textContent = explorers;
        el.style.opacity = '1';
      }, 150);
    }, 4000);

    setInterval(updateOpenCount, 60000);

    setInterval(() => {
      MapModule.refreshMarkerStates(allMerchants);
      updateListStatuses();
    }, 60000);
  }

  function updateOpenCount() {
    const count = Signals.countOpen(allMerchants);
    document.getElementById('open-count').textContent = count;
  }

  function updateListStatuses() {
    const now = new Date();
    document.querySelectorAll('.merchant-item').forEach(item => {
      const id = Number(item.dataset.id);
      const merchant = allMerchants.find(m => m.id === id);
      if (!merchant) return;
      const status = Signals.getOpenStatus(merchant, now);
      const statusEl = item.querySelector('.merchant-status');
      statusEl.className = `merchant-status ${status.status}`;
      statusEl.textContent = Signals.getStatusBadge(status);
    });
  }

  // ---- Ripple Loop ----

  function startRippleLoop() {
    function doRipple() {
      const popular = allMerchants.filter(m => m.stats.visits > 10);
      if (popular.length === 0) return;
      const rand = popular[Math.floor(Math.random() * popular.length)];
      MapModule.triggerRipple(rand.id);
    }

    setInterval(() => {
      const delay = 7000 + Math.random() * 3000;
      setTimeout(doRipple, delay);
    }, 10000);
  }

  // ---- Modal ----

  function openModal(merchant) {
    const now = new Date();
    const status = Signals.getOpenStatus(merchant, now);
    const evt = merchantEventMap[merchant.id];

    // Photo
    const photoEl = document.getElementById('modal-photo');
    photoEl.innerHTML = `<img src="assets/images/merchants/${merchant.id}.png" alt="${merchant.name}" class="modal-photo-img" onerror="this.parentElement.innerHTML='<div class=\\'photo-placeholder\\'>${evt ? evt.icon : '📷'}</div>'">`;

    // Event badge on modal
    const modalEventBadge = document.getElementById('modal-event-badge');
    if (modalEventBadge && evt) {
      modalEventBadge.innerHTML = `<span class="modal-event-tag" style="background:${evt.color}">${evt.icon} ${evt.name}</span>`;
    }

    document.getElementById('modal-name').textContent = merchant.name;
    document.getElementById('modal-dish').textContent = merchant.dish.name;
    document.getElementById('modal-dish-desc').textContent = merchant.dish.description;
    document.getElementById('modal-price').textContent = merchant.dish.price || '';
    document.getElementById('modal-address').textContent = merchant.address;
    document.getElementById('modal-status').textContent = Signals.getStatusBadge(status);
    document.getElementById('modal-status').className = `modal-status ${status.status}`;

    // Weekly hours
    const hoursEl = document.getElementById('modal-hours');
    const rows = Signals.getWeeklyScheduleDisplay(merchant);
    hoursEl.innerHTML = `
      <table class="schedule-table">
        ${rows.map(r => `
          <tr class="${r.isToday ? 'schedule-today' : ''} ${r.isClosed ? 'schedule-closed' : ''}">
            <td class="schedule-day">${r.day}</td>
            <td class="schedule-time">${r.schedule}</td>
          </tr>
        `).join('')}
      </table>
    `;

    // Tags
    const tagsEl = document.getElementById('modal-tags');
    tagsEl.innerHTML = merchant.tags.map(t =>
      `<span class="modal-tag">🏷️ ${Signals.getTagLabel(t)}</span>`
    ).join('');

    // Route button
    document.getElementById('modal-btn-route').onclick = () => {
      MapModule.openRoute(merchant);
    };

    // Stats button
    const statsBtn = document.getElementById('modal-btn-stats');
    statsBtn.href = `comerciante.html?id=${merchant.id}`;

    // Show modal
    const overlay = document.getElementById('modal-overlay');
    overlay.classList.remove('hidden');

    // Close handlers
    document.getElementById('modal-close').onclick = closeModal;
    document.getElementById('modal-back').onclick = closeModal;
    overlay.onclick = (e) => {
      if (e.target === overlay) closeModal();
    };
  }

  function closeModal() {
    document.getElementById('modal-overlay').classList.add('hidden');
  }

  // ESC key to close modal
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeModal();
    }
  });

  // ---- Public API ----

  return {
    init,
    openModal,
    closeModal,
    resetListStates,
    setActiveItem,
    get merchants() { return allMerchants; },
    get events() { return events; },
    getEventForMerchant(id) { return merchantEventMap[id]; }
  };
})();

// Start the app
document.addEventListener('DOMContentLoaded', () => {
  App.init();
});
