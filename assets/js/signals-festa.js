// ===== SignalsFesta: Status logic for datetime-based events (Festa Major) =====
// Compatible with the Signals interface expected by map.js.

const SignalsFesta = (() => {
  const STARTING_SOON_MINUTES = 60;

  // ---- Core datetime logic ----

  /**
   * Compute actual Date from act's day_offset ("0" = today) and time ("HH:MM").
   */
  function getActDatetime(act) {
    const [h, m] = act.time.split(':').map(Number);
    const d = new Date();
    d.setHours(h, m, 0, 0);
    d.setDate(d.getDate() + act.day_offset);
    return d;
  }

  function getActEndDatetime(act) {
    const start = getActDatetime(act);
    const end = new Date(start);
    end.setMinutes(end.getMinutes() + (act.duration_minutes || 90));
    return end;
  }

  /**
   * Get status of an act at a given time.
   * Returns festa-native statuses.
   */
  function getActStatus(act, now) {
    if (!now) now = new Date();
    const start = getActDatetime(act);
    const end   = getActEndDatetime(act);
    const msUntilStart     = start - now;
    const minutesUntilStart = msUntilStart / 60000;

    if (now >= end) {
      return { status: 'past', label: 'Finalitzat' };
    }

    if (now >= start) {
      const minutesLeft = Math.round((end - now) / 60000);
      if (minutesLeft <= 15) {
        return { status: 'ending-soon', label: `Acaba en ${minutesLeft} min` };
      }
      const endH = end.getHours();
      const endM = String(end.getMinutes()).padStart(2, '0');
      return { status: 'happening-now', label: `Ara · fins les ${endH}:${endM}h` };
    }

    if (minutesUntilStart > 0 && minutesUntilStart <= STARTING_SOON_MINUTES) {
      const mins = Math.round(minutesUntilStart);
      return { status: 'starting-soon', label: `Comença en ${mins} min` };
    }

    if (act.day_offset === 0) {
      const startH = start.getHours();
      const startM = String(start.getMinutes()).padStart(2, '0');
      return { status: 'today-later', label: `Avui a les ${startH}:${startM}h` };
    }

    if (act.day_offset < 0) {
      return { status: 'past', label: 'Finalitzat' };
    }

    const startH = start.getHours();
    const startM = String(start.getMinutes()).padStart(2, '0');
    return { status: 'future', label: `${getDayLabel(act.day_offset)} a les ${startH}:${startM}h` };
  }

  // ---- Signals-compatible interface (used by map.js) ----

  /**
   * map.js calls Signals.getOpenStatus(merchant, now).
   * We normalize festa statuses to the gastro-compatible set.
   */
  function getOpenStatus(act, now) {
    const s = getActStatus(act, now);
    const normalize = {
      'happening-now':  'open',
      'ending-soon':    'closing-soon',
      'starting-soon':  'opening-soon',
      'today-later':    'open',
      'past':           'closed',
      'future':         'open',
    };
    return {
      status: normalize[s.status] || 'closed',
      label:  s.label,
      _festa: s.status, // original for CSS classes in app-festa
    };
  }

  /**
   * map.js calls Signals.getMarkerClasses(merchant, now).
   */
  function getMarkerClasses(act, now) {
    const status     = getOpenStatus(act, now);
    const festaStatus = status._festa;
    let classes = [];

    switch (festaStatus) {
      case 'happening-now':  classes = ['marker-open',         'pulse-fast'];  break;
      case 'ending-soon':    classes = ['marker-closing-soon', 'pulse'];        break;
      case 'starting-soon':  classes = ['marker-opening-soon', 'pulse'];        break;
      case 'today-later':    classes = ['marker-open'];                         break;
      case 'future':         classes = ['marker-open'];                         break;
      default:               classes = ['marker-closed'];
    }

    return { classes, status, popularity: { level: 'normal' } };
  }

  /**
   * map.js calls Signals.countOpen(merchants, now) for the "open count" stat.
   */
  function countOpen(acts, now) {
    return countHappeningNow(acts, now);
  }

  /**
   * map.js calls Signals.getStatusBadge(status).
   */
  function getStatusBadge(status) {
    // status may be the normalized (gastro) or festa object
    const s = status._festa || status.status;
    const dotMap = {
      'happening-now':  'dot-open',
      'ending-soon':    'dot-closing-soon',
      'starting-soon':  'dot-opening-soon',
      'today-later':    'dot-open',
      'past':           'dot-closed',
      'future':         'dot-open',
      // gastro fallbacks
      'open':           'dot-open',
      'closing-soon':   'dot-closing-soon',
      'opening-soon':   'dot-opening-soon',
      'closed':         'dot-closed',
    };
    const dotClass = dotMap[s] || 'dot-closed';
    return `<span class="status-dot ${dotClass}"></span>${status.label}`;
  }

  function getTagLabel(tag) { return tag; }

  function getPopularity() { return { level: 'normal' }; }

  // ---- Festa-specific helpers ----

  function getDayLabel(offset) {
    if (offset ===  0) return 'Avui';
    if (offset === -1) return 'Ahir';
    if (offset ===  1) return 'Demà';
    const d = new Date();
    d.setDate(d.getDate() + offset);
    return ['Diumenge','Dilluns','Dimarts','Dimecres','Dijous','Divendres','Dissabte'][d.getDay()];
  }

  function getDayTitle(offset) {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    const months = ['gen','feb','mar','abr','mai','jun','jul','ago','set','oct','nov','des'];
    return `${getDayLabel(offset)} · ${d.getDate()} ${months[d.getMonth()]}`;
  }

  function countHappeningNow(acts, now) {
    if (!now) now = new Date();
    return acts.filter(a => {
      const s = getActStatus(a, now);
      return s.status === 'happening-now' || s.status === 'ending-soon';
    }).length;
  }

  function getDayOffsets(acts) {
    return [...new Set(acts.map(a => a.day_offset))].sort((a, b) => a - b);
  }

  function getTypeIcon(type) {
    const icons = {
      'concert':     '🎵',
      'ball':        '💃',
      'taller':      '🎨',
      'mercat':      '🛒',
      'esport':      '⚽',
      'cercavila':   '🥁',
      'exposicio':   '🖼️',
      'gastro':      '🍽️',
      'infantil':    '🎪',
      'conferencia': '🎤',
      'sopar':       '🍷',
      'vermut':      '🥂',
      'visita':      '🗺️',
      'esbart':      '🪘',
    };
    return icons[type] || '📌';
  }

  return {
    // Signals-compatible (map.js interface)
    getOpenStatus,
    getMarkerClasses,
    getStatusBadge,
    getTagLabel,
    getPopularity,
    countOpen,
    // Festa-specific
    getActStatus,
    getActDatetime,
    getActEndDatetime,
    getDayLabel,
    getDayTitle,
    countHappeningNow,
    getDayOffsets,
    getTypeIcon,
  };
})();
