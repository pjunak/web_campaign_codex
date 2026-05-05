// Tiny pre-boot script. Runs before app.js (loaded as a deferred
// <script src="…">), so it fires synchronously after parse and the
// first render paints with the saved state — no flicker.
//
// Lives in its own file (rather than inline in index.html) so the
// page can run under `Content-Security-Policy: script-src 'self'`
// without an `'unsafe-inline'` exemption.
(function () {
  try {
    if (localStorage.getItem('sidebar_kompendium_open') === '1') {
      document.getElementById('sidebar-kompendium-toggle')?.classList.add('is-open');
      document.getElementById('sidebar-kompendium')?.classList.add('is-open');
      document.getElementById('sidebar-kompendium-toggle')?.setAttribute('aria-expanded', 'true');
    }
  } catch (_) {}
})();
