// ===== Main: Demo dispatcher =====
// Reads ?demo= URL param and boots the appropriate app and signals module.

(() => {
  const params = new URLSearchParams(window.location.search);
  const demoType = params.get('demo') || 'platillos';

  document.addEventListener('DOMContentLoaded', () => {
    document.body.dataset.demo = demoType;

    if (demoType === 'hostafrancs') {
      window.Signals = SignalsFesta;
      window.App    = AppFesta;
      document.title = 'Revent – Festa Major d\'Hostafrancs';
      AppFesta.init();
    } else {
      window.Signals = Signals;
      window.App    = App;
      document.title = 'Revent – A la tardor, platillos';
      App.init();
    }
  });
})();
