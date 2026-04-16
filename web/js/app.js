// ═══════════════════════════════════════════════════════════════
//  APP — router + navigation state
// ═══════════════════════════════════════════════════════════════

import { Store } from './store.js';
import { EditMode } from './editmode.js';
import { Wiki } from './wiki.js';
import { CloudMap } from './cloudmap.js';
import { Timeline } from './timeline.js';
import { WorldMap } from './map.js';
import { Admin } from './admin.js';
import { Widgets } from './widgets/widgets.js';

// Expose modules to global scope for inline event handlers (onclick="...")
window.Store = Store;
window.EditMode = EditMode;
window.Wiki = Wiki;
window.CloudMap = CloudMap;
window.Timeline = Timeline;
window.WorldMap = WorldMap;
window.Admin = Admin;

(function () {

  // ── Register Cytoscape plugins ──────────────────────────────
  if (typeof cytoscape !== "undefined" && typeof dagre !== "undefined") {
    try { cytoscape.use(cytoscapeDagre); } catch(e) {}
  }

  // ── Router ──────────────────────────────────────────────────
  function getRoute() {
    return window.location.hash.replace(/^#/, "") || "/";
  }

  function navigate(route) {
    // Schedule widget mount after the page renders. Runs for every route so
    // any cb-mount/ms-mount placeholders in newly-rendered HTML get wired up.
    requestAnimationFrame(() => Widgets.mountAll(document.body));

    // Mind-map sub-routes that all belong to Myšlenkový Palác
    const PALAC_ROUTES = new Set(["/mapa/palac", "/mapa/frakce", "/mapa/vztahy", "/mapa/tajemstvi"]);

    // Sync sidebar active state
    document.querySelectorAll("[data-route]").forEach(el => {
      const r = el.dataset.route;
      let active = r === route || r === "/" + route.split("/")[1] || route.startsWith(r + "/");
      // Highlight Myšlenkový Palác for all mind-map sub-routes
      if (r === "/mapa/palac" && PALAC_ROUTES.has(route)) active = true;
      el.classList.toggle("active", active);
    });

    // Sync bottom nav active state
    document.querySelectorAll(".bottom-item[data-route]").forEach(el => {
      const r = el.dataset.route;
      el.classList.toggle("active",
        route === r || ("/" + route.split("/")[1]) === r || route.startsWith(r.replace(/^\//, "") + "/")
      );
    });

    const parts   = route.split("/").filter(Boolean);
    const section = parts[0] || "";
    const sub     = parts[1] || "";

    // Maps — full-screen layout
    if (section === "mapa") {
      if (sub === "svet") {
        WorldMap.render();
      } else if (sub === "casova-osa") {
        Timeline.render();
      } else if (sub === "palac" || sub === "frakce" || sub === "vztahy" || sub === "tajemstvi") {
        CloudMap.render(sub === "palac" ? "frakce" : sub);
      } else {
        CloudMap.render("frakce");
      }
      return;
    }

    // Ensure main content is visible
    const main = document.getElementById("main-content");
    if (main) main.style.display = "";

    switch (section) {
      case "":
      case "dashboard":
        Wiki.renderPage("dashboard"); break;
      case "postavy":
        Wiki.renderPage("postavy"); break;
      case "postava":
        Wiki.renderPage("postava", sub); break;
      case "mista":
        Wiki.renderPage("mista"); break;
      case "misto":
        Wiki.renderPage("misto", sub); break;
      case "udalosti":
        Wiki.renderPage("udalosti"); break;
      case "udalost":
        Wiki.renderPage("udalost", sub); break;
      case "zahady":
        Wiki.renderPage("zahady"); break;
      case "zahada":
        Wiki.renderPage("zahada", sub); break;
      case "frakce":
        if (sub) Wiki.renderPage("frakce-id", sub);
        else     Wiki.renderPage("frakce");
        break;
      case "admin":
        Admin.render(); break;
      default:
        Wiki.renderPage("dashboard");
    }
  }

  // ── Collaborative polling ───────────────────────────────────
  // Every 30 s, ask the server if the data changed.
  // If it did, reload the current view so all group members
  // see up-to-date information without a full page refresh.
  let _lastHash    = null;
  let _pollPaused  = false;   // pause while the user is actively editing

  function _startPolling() {
    setInterval(async () => {
      if (_pollPaused) return;
      try {
        const res = await fetch('/api/version');
        if (!res.ok) return;
        const { hash } = await res.json();
        if (_lastHash === null) { _lastHash = hash; return; }
        if (hash !== _lastHash) {
          _lastHash = hash;
          await Store.load();          // refresh in-memory data
          navigate(getRoute());        // re-render current view
        }
      } catch (_) { /* server temporarily unreachable — will retry next interval */ }
    }, 30_000);
  }

  // Pause polling while the user has a form focused
  document.addEventListener("focusin",  e => { if (e.target.matches("input,textarea,select")) _pollPaused = true;  });
  document.addEventListener("focusout", e => { if (e.target.matches("input,textarea,select")) _pollPaused = false; });

  // ── Init ────────────────────────────────────────────────────
  window.addEventListener("hashchange", () => navigate(getRoute()));

  // ── Server availability banner ──────────────────────────────
  // Shown when the server is unreachable at startup or a save fails mid-session.
  function _showServerBanner(msg) {
    let banner = document.getElementById("server-banner");
    if (!banner) {
      banner = document.createElement("div");
      banner.id = "server-banner";
      banner.style.cssText = [
        "position:fixed", "top:0", "left:0", "right:0", "z-index:9999",
        "background:#8B0000", "color:#fff", "font-size:13px",
        "padding:8px 16px", "text-align:center",
        "font-family:system-ui,sans-serif", "letter-spacing:0.02em",
      ].join(";");
      document.body.prepend(banner);
    }
    banner.textContent = msg;
  }

  window.addEventListener("store:server-unavailable", () => {
    _showServerBanner("⚠ Server není dostupný — zobrazují se výchozí data. Změny nebudou uloženy.");
  });
  window.addEventListener("store:save-failed", () => {
    _showServerBanner("⚠ Uložení na server selhalo — zkontrolujte připojení a znovu načtěte stránku.");
  });

  window.addEventListener("DOMContentLoaded", async () => {
    // Load data from server before first render
    await Store.load();

    // Remove loading screen
    const loading = document.getElementById("loading");
    if (loading) loading.remove();

    // Backup button is a plain <a href="/api/backup"> — no JS wiring needed.
    // It's only visible in edit mode (CSS .edit-only-btn).

    // Mobile map sheet
    const mapItems = document.querySelectorAll('.bottom-item[data-route="/mapa/frakce"]');
    mapItems.forEach(item => {
      item.addEventListener("click", e => {
        if (!getRoute().startsWith("/mapa")) { e.preventDefault(); showMapSheet(); }
      });
    });

    const backdrop = document.getElementById("map-backdrop");
    if (backdrop) backdrop.addEventListener("click", hideMapSheet);

    const sheet = document.getElementById("map-sheet");
    if (sheet) {
      sheet.querySelectorAll(".map-sheet-item").forEach(el =>
        el.addEventListener("click", () => hideMapSheet())
      );
    }

    navigate(getRoute());
    _startPolling();
  });

  function showMapSheet() {
    document.getElementById("map-sheet"   )?.removeAttribute("hidden");
    document.getElementById("map-backdrop")?.removeAttribute("hidden");
  }
  function hideMapSheet() {
    document.getElementById("map-sheet"   )?.setAttribute("hidden", "");
    document.getElementById("map-backdrop")?.setAttribute("hidden", "");
  }

})();
