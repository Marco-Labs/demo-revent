/**
 * DashboardMap — Manages two Leaflet map instances:
 *   1. Digital map (#digital-map) — merchant markers + influence zone
 *   2. Territory map (#terr-map) — isochrone rings + merchant markers
 */
const DashboardMap = (() => {
  'use strict';

  const CENTER = [41.362, 2.110];
  const BASEMAP = 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';
  const BASEMAP_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>';

  let digitalMap = null;
  let terrMap = null;
  const isoLayers = {};
  let activeIsoKey = null;
  let heatLayer = null;
  let storedMerchants = null;

  const ISO_STYLES = {
    walk_5:      { color: '#FF6B00', fillColor: '#FF6B00', fillOpacity: 0.22, weight: 2.5, opacity: 0.8 },
    walk_15:     { color: '#FF8C00', fillColor: '#FF8C00', fillOpacity: 0.13, weight: 1.5, opacity: 0.6 },
    walk_30:     { color: '#FFA726', fillColor: '#FFE0B2', fillOpacity: 0.07, weight: 1,   opacity: 0.4 },
    transit_15:  { color: '#1976D2', fillColor: '#1976D2', fillOpacity: 0.13, weight: 1.5, opacity: 0.6 },
    transit_30:  { color: '#42A5F5', fillColor: '#42A5F5', fillOpacity: 0.07, weight: 1,   opacity: 0.4 },
    transit_60:  { color: '#90CAF9', fillColor: '#BBDEFB', fillOpacity: 0.04, weight: 0.75, opacity: 0.3 },
  };

  const DIM_FACTOR = 0.35;

  // ── Init ────────────────────────────────────────────────────

  function init(isochronesGeoJson, merchantsData) {
    initDigitalMap(merchantsData);
    initTerrMap(isochronesGeoJson, merchantsData);
  }

  // ── Digital Map ─────────────────────────────────────────────

  function initDigitalMap(merchantsData) {
    storedMerchants = merchantsData.events[0] ? merchantsData.events[0].merchants : [];
    digitalMap = L.map('digital-map', {
      zoomControl: true,
      minZoom: 12,
      maxZoom: 18,
      attributionControl: false,
    }).setView(CENTER, 14);

    L.tileLayer(BASEMAP, { subdomains: 'abcd', maxZoom: 19 }).addTo(digitalMap);

    addMerchantMarkers(digitalMap, merchantsData);
    loadInfluenceZone(digitalMap, true);
    buildHeatLayers();

    // Fix Leaflet render issue when map is in a hidden/sized container
    setTimeout(() => digitalMap.invalidateSize(), 200);
  }

  // ── Territory Map ───────────────────────────────────────────

  function initTerrMap(isochronesGeoJson, merchantsData) {
    terrMap = L.map('terr-map', {
      zoomControl: true,
      minZoom: 11,
      maxZoom: 18,
      attributionControl: false,
    }).setView(CENTER, 14);

    L.tileLayer(BASEMAP, { subdomains: 'abcd', maxZoom: 19 }).addTo(terrMap);

    addIsochroneRings(isochronesGeoJson);
    addMerchantMarkers(terrMap, merchantsData);
    loadInfluenceZone(terrMap);

    setTimeout(() => terrMap.invalidateSize(), 200);
  }

  // ── Isochrone Rings (territory map only) ────────────────────

  function addIsochroneRings(geojson) {
    const ordered = [...geojson.features].sort((a, b) => b.properties.minutes - a.properties.minutes);

    ordered.forEach(feature => {
      const key = feature.properties.id;
      const baseStyle = ISO_STYLES[key] || ISO_STYLES.walk_5;

      const layer = L.geoJSON(feature, {
        style: () => ({ ...baseStyle }),
        interactive: true,
      });

      layer.on('click', () => {
        if (window.Dashboard && window.Dashboard.selectIsochrone) {
          window.Dashboard.selectIsochrone(key);
        }
      });

      layer.on('mouseover', (e) => {
        if (activeIsoKey !== key) {
          e.target.setStyle({
            fillOpacity: baseStyle.fillOpacity + 0.08,
            weight: baseStyle.weight + 0.5,
          });
        }
      });

      layer.on('mouseout', (e) => {
        if (activeIsoKey !== key) {
          applyDimStyle(key);
        }
      });

      layer.addTo(terrMap);
      isoLayers[key] = layer;
    });
  }

  // ── Highlight isochrone ─────────────────────────────────────

  function highlightIsochrone(key) {
    activeIsoKey = key;

    Object.entries(isoLayers).forEach(([k, layer]) => {
      const base = ISO_STYLES[k];
      if (k === key) {
        layer.setStyle({
          fillOpacity: Math.min(base.fillOpacity + 0.15, 0.45),
          weight: base.weight + 1.5,
          opacity: Math.min(base.opacity + 0.3, 1),
          color: base.color,
          fillColor: base.fillColor,
        });
        layer.bringToFront();
      } else {
        applyDimStyle(k);
      }
    });

    const layer = isoLayers[key];
    if (layer && terrMap) {
      terrMap.fitBounds(layer.getBounds(), { padding: [30, 30], maxZoom: 16 });
    }
  }

  function applyDimStyle(key) {
    const base = ISO_STYLES[key];
    const layer = isoLayers[key];
    if (!layer || !base) return;
    layer.setStyle({
      fillOpacity: base.fillOpacity * DIM_FACTOR,
      weight: base.weight * 0.7,
      opacity: base.opacity * DIM_FACTOR,
      color: base.color,
      fillColor: base.fillColor,
    });
  }

  // ── Shared helpers ──────────────────────────────────────────

  function addMerchantMarkers(map, merchantsData) {
    const event = merchantsData.events[0];
    if (!event) return;

    event.merchants.forEach(m => {
      const icon = L.divIcon({
        className: '',
        html: '<div class="dash-marker"></div>',
        iconSize: [12, 12],
        iconAnchor: [6, 6],
      });

      const marker = L.marker([m.coordinates.lat, m.coordinates.lng], { icon }).addTo(map);
      marker.bindTooltip(m.name, {
        direction: 'top',
        offset: [0, -8],
        className: 'dash-marker-tooltip',
      });
    });
  }

  async function loadInfluenceZone(map, fitToZone) {
    try {
      const resp = await fetch('assets/data/union_5min.geojson');
      const geojson = await resp.json();
      const layer = L.geoJSON(geojson, {
        style: {
          color: '#FF6B00',
          fillColor: '#FF6B00',
          fillOpacity: 0.06,
          weight: 1.5,
          opacity: 0.3,
          dashArray: '6 4',
        },
        interactive: false,
      }).addTo(map);

      if (fitToZone) {
        map.fitBounds(layer.getBounds(), { padding: [10, 10], maxZoom: 15 });
      }
    } catch (e) {
      console.warn('Could not load influence zone:', e);
    }
  }

  function getIsoStyles() { return ISO_STYLES; }

  // ── Invalidate sizes (call after layout changes) ────────────

  function invalidate() {
    if (digitalMap) digitalMap.invalidateSize();
    if (terrMap) terrMap.invalidateSize();
  }

  // ── Heatmap layers (digital map only) ───────────────────────

  const HEAT_LAYERS = {};
  const HEAT_LABELS = {
    visits:   'Visites uniques',
    profiles: 'Visites a perfils',
    routes:   'Clics en ruta',
  };

  const METRIC_MAP = {
    visits:   m => m.stats.visits,
    profiles: m => m.stats.visits,
    routes:   m => m.stats.routes,
  };

  // Seeded PRNG for reproducible scatter.
  function mulberry32(seed) {
    return function() {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  // Generate scattered heat points simulating user queries from across the area.
  // Users consult from home/work, not necessarily near merchants, so points
  // spread well beyond the merchant locations with varied density clusters.
  function generateHeatPoints(metricKey) {
    const getter = METRIC_MAP[metricKey] || METRIC_MAP.visits;
    const maxVal = Math.max(...storedMerchants.map(getter), 1);
    const rng = mulberry32(metricKey.length * 1337);
    const points = [];

    // Compute centroid for area-wide scatter.
    let cLat = 0, cLng = 0;
    storedMerchants.forEach(m => { cLat += m.coordinates.lat; cLng += m.coordinates.lng; });
    cLat /= storedMerchants.length;
    cLng /= storedMerchants.length;

    // 1) Points near merchants (local hotspots, ~30% of total).
    storedMerchants.forEach(m => {
      const val = getter(m);
      const intensity = val / maxVal;
      const count = Math.max(4, Math.round(intensity * 15));
      const spread = 0.002;

      for (let i = 0; i < count; i++) {
        const u1 = rng(), u2 = rng();
        const r = Math.sqrt(-2 * Math.log(u1 || 0.001));
        const theta = 2 * Math.PI * u2;
        points.push([
          m.coordinates.lat + r * Math.cos(theta) * spread * 0.5,
          m.coordinates.lng + r * Math.sin(theta) * spread * 0.6,
          intensity * (0.5 + rng() * 0.5),
        ]);
      }
    });

    // 2) Dispersed points across the wider area (~70% of total).
    //    Simulates users browsing from home, work, transit, etc.
    const dispersedCount = Math.round(storedMerchants.length * 12);
    for (let i = 0; i < dispersedCount; i++) {
      const u1 = rng(), u2 = rng();
      const r = Math.sqrt(-2 * Math.log(u1 || 0.001));
      const theta = 2 * Math.PI * u2;
      // Wide spread: ~1-2km radius from centroid.
      const spread = 0.012 + rng() * 0.008;
      const lat = cLat + r * Math.cos(theta) * spread * 0.5;
      const lng = cLng + r * Math.sin(theta) * spread * 0.6;
      // Lower intensity for distant points.
      const intensity = 0.1 + rng() * 0.4;
      points.push([lat, lng, intensity]);
    }

    // 3) A few high-density clusters in nearby neighbourhoods.
    const clusterCenters = [
      [cLat + 0.008, cLng - 0.005],  // north-west (residential)
      [cLat - 0.006, cLng + 0.008],  // south-east (commercial)
      [cLat + 0.003, cLng + 0.012],  // east (transit hub)
    ];
    clusterCenters.forEach(([clLat, clLng]) => {
      const clusterSize = 8 + Math.round(rng() * 12);
      for (let i = 0; i < clusterSize; i++) {
        const u1 = rng(), u2 = rng();
        const r = Math.sqrt(-2 * Math.log(u1 || 0.001));
        const theta = 2 * Math.PI * u2;
        points.push([
          clLat + r * Math.cos(theta) * 0.003,
          clLng + r * Math.sin(theta) * 0.004,
          0.3 + rng() * 0.5,
        ]);
      }
    });

    return points;
  }

  function buildHeatLayers() {
    if (!digitalMap || !storedMerchants.length) return;

    Object.keys(METRIC_MAP).forEach(key => {
      const points = generateHeatPoints(key);
      HEAT_LAYERS[key] = L.heatLayer(points, {
        radius: 28,
        blur: 20,
        maxZoom: 17,
        max: 1.0,
        gradient: { 0.15: '#FFE0B2', 0.4: '#FFA726', 0.65: '#FF6B00', 0.85: '#E65100', 1: '#BF360C' },
      });
    });

    // Custom pill-button control on the map.
    const HeatControl = L.Control.extend({
      options: { position: 'bottomleft' },
      onAdd: function() {
        const container = L.DomUtil.create('div', 'heat-toggle-bar');
        L.DomEvent.disableClickPropagation(container);
        L.DomEvent.disableScrollPropagation(container);

        Object.entries(HEAT_LABELS).forEach(([key, label]) => {
          const btn = L.DomUtil.create('button', 'heat-toggle-btn', container);
          btn.textContent = label;
          btn.dataset.layer = key;
          btn.addEventListener('click', () => {
            const active = btn.classList.contains('active');
            if (active) {
              digitalMap.removeLayer(HEAT_LAYERS[key]);
              btn.classList.remove('active');
            } else {
              HEAT_LAYERS[key].addTo(digitalMap);
              btn.classList.add('active');
            }
          });
        });

        return container;
      },
    });

    new HeatControl().addTo(digitalMap);
  }

  return {
    init,
    highlightIsochrone,
    getIsoStyles,
    invalidate,
  };
})();
