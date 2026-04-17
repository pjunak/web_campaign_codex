// ═══════════════════════════════════════════════════════════════
//  WIKI — renders character, location and event articles.
//  Uses Store for all data. Checks EditMode.isActive() to switch
//  between read-only view and inline edit forms.
// ═══════════════════════════════════════════════════════════════

import { Store } from './store.js';
import { EditMode } from './editmode.js';

export const Wiki = (() => {

  const KNOWLEDGE_LABELS = ["Neznámý","Tušený","Základní","Dobře znám","Plně zmapován"];

  function factionBadge(factionId) {
    const f = Store.getFactions()[factionId] || Store.getFactions().neutral;
    return `<span class="badge badge-faction" style="background:${f.color}22;color:${f.textColor};border:1px solid ${f.color}55">
      ${f.badge} ${f.name}</span>`;
  }

  function statusBadge(statusId) {
    const s = Store.getStatusMap()[statusId] || Store.getStatusMap().unknown;
    return `<span class="badge badge-status-${statusId}">${s.icon} ${s.label}</span>`;
  }

  function knowledgeBadge(lvl) {
    return `<span class="badge badge-knowledge">👁 ${KNOWLEDGE_LABELS[lvl] || "?"}</span>`;
  }

  function relationLabel(type) {
    return {
      commands:"velí", ally:"spojenec/kyně", enemy:"nepřítel", mission:"mise",
      mystery:"záhada", captured_by:"zajat/a", history:"historie",
      uncertain:"nejasná vazba", negotiates:"vyjednává",
    }[type] || type;
  }

  // ── Portrait wrapper (knowledge + dead overlay) ────────────────
  function portraitWrap(c, extraClass) {
    const factions  = Store.getFactions();
    const deadHtml  = c.status === "dead" ? `<div class="dead-overlay">💀</div>` : "";
    const imgHtml   = c.portrait
      ? `<img class="portrait-img" src="${c.portrait}" alt="${c.name}" loading="lazy">`
      : `<div class="portrait-placeholder">${factions[c.faction]?.badge || "👤"}</div>`;
    return `<div class="portrait-wrap${extraClass ? " "+extraClass : ""}" data-knowledge="${c.knowledge}" data-status="${c.status}">
      ${imgHtml}${deadHtml}
    </div>`;
  }

  // ── Edit overlay on cards (only visible in edit mode) ─────────
  function editOverlay(href) {
    return `<span class="edit-card-overlay" title="Upravit">✏</span>`;
  }

  // ══════════════════════════════════════════════════════════════
  //  DASHBOARD
  // ══════════════════════════════════════════════════════════════
  function renderDashboard() {
    const chars     = Store.getCharacters();
    const mysteries = Store.getMysteries();
    const totalChars    = chars.length;
    const knownChars    = chars.filter(c => c.knowledge >= 3).length;
    const openMysteries = mysteries.length;
    const capturedCount = chars.filter(c => c.status === "captured").length;

    return `
      <div class="text-center" style="padding-top:1rem">
        <div class="dashboard-title">O Barvách Draků</div>
        <div class="dashboard-subtitle">Kodex Kampaně</div>
        <div class="dashboard-divider"></div>
      </div>

      <div class="dash-section-title">Mind Mapy</div>
      <div class="dashboard-grid">
        <a href="#/mapa/frakce"     class="dash-card" style="text-decoration:none">
          <div class="dash-card-icon">⬡</div>
          <div class="dash-card-title">Frakce &amp; Hierarchie</div>
          <div class="dash-card-desc">Kdo patří kam. Hierarchie Dračího Kultu, naše parta, greenestské postavy a draci.</div>
        </a>
        <a href="#/mapa/vztahy"    class="dash-card" style="text-decoration:none">
          <div class="dash-card-icon">🕸</div>
          <div class="dash-card-title">Vztahová Síť</div>
          <div class="dash-card-desc">Osobní vazby mezi postavami — spojenectví, nepřátelství, záhady.</div>
        </a>
        <a href="#/mapa/tajemstvi" class="dash-card" style="text-decoration:none">
          <div class="dash-card-icon">❓</div>
          <div class="dash-card-title">Záhady &amp; Stopy</div>
          <div class="dash-card-desc">Otevřené otázky a co k nim víme. ${openMysteries} aktivních záhad.</div>
        </a>
        <a href="#/mapa/casova-osa" class="dash-card" style="text-decoration:none">
          <div class="dash-card-icon">📜</div>
          <div class="dash-card-title">Časová Osa</div>
          <div class="dash-card-desc">Události kampaně v chronologickém pořadí s propojením na postavy.</div>
        </a>
      </div>

      <div class="dash-section-title" style="margin-top:2rem">Rychlý Přehled</div>
      <div class="dashboard-grid" style="grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:0.75rem">
        <a href="#/postavy" class="dash-card" style="text-decoration:none;text-align:center">
          <div style="font-size:2rem;margin-bottom:0.35rem">👤</div>
          <div class="dash-card-title" style="font-size:1.6rem;margin-bottom:0">${totalChars}</div>
          <div class="dash-card-desc">Postav</div>
        </a>
        <div class="dash-card" style="text-align:center">
          <div style="font-size:2rem;margin-bottom:0.35rem">👁</div>
          <div class="dash-card-title" style="font-size:1.6rem;margin-bottom:0">${knownChars}</div>
          <div class="dash-card-desc">Dobře zmapovaných</div>
        </div>
        <div class="dash-card" style="text-align:center;border-color:rgba(106,27,154,0.3)">
          <div style="font-size:2rem;margin-bottom:0.35rem">❓</div>
          <div class="dash-card-title" style="font-size:1.6rem;margin-bottom:0;color:#ce93d8">${openMysteries}</div>
          <div class="dash-card-desc">Záhad</div>
        </div>
        <div class="dash-card" style="text-align:center;border-color:rgba(21,101,192,0.3)">
          <div style="font-size:2rem;margin-bottom:0.35rem">⛓</div>
          <div class="dash-card-title" style="font-size:1.6rem;margin-bottom:0;color:#90caf9">${capturedCount}</div>
          <div class="dash-card-desc">Zajatých</div>
        </div>
      </div>

      <div class="dash-section-title" style="margin-top:2rem">Kritické Záhady</div>
      <div class="mystery-list">
        ${mysteries.filter(m => m.priority === "kritická" || m.priority === "vysoká").map(m => `
          <div class="mystery-card">
            <div class="mystery-name">❓ ${m.name}</div>
            <div class="mystery-priority priority-${m.priority}">${m.priority.toUpperCase()}</div>
            <div class="mystery-desc">${m.description}</div>
          </div>`).join("")}
      </div>
    `;
  }

  // ══════════════════════════════════════════════════════════════
  //  CHARACTER LIST
  // ══════════════════════════════════════════════════════════════
  function renderCharacterList(filterFaction) {
    const factions = Store.getFactions();
    let chars = Store.getCharacters();
    if (filterFaction) chars = chars.filter(c => c.faction === filterFaction);

    const factionOrder = ["party","cult_high","cult_red","dragon","greenest","neutral","mystery"];
    chars = [...chars].sort((a,b) =>
      factionOrder.indexOf(a.faction) - factionOrder.indexOf(b.faction)
    );

    const allChars = Store.getCharacters();
    const filters = Object.entries(factions).map(([id, f]) => {
      const count = allChars.filter(c => c.faction === id).length;
      if (count === 0) return "";
      return `<button class="filter-btn ${filterFaction === id ? "active" : ""}"
        onclick="Wiki.renderPage('postavy','${id}')">${f.badge} ${f.name} (${count})</button>`;
    }).join("");

    const newCard = EditMode.isActive() ? `
      <a class="char-card char-card-new" href="#/postava/new" style="text-decoration:none">
        <div class="char-card-new-icon">＋</div>
        <div class="char-card-new-label">Nová postava</div>
      </a>` : "";

    return `
      <div class="page-header">
        <h1>Postavy</h1>
        <div class="subtitle">${chars.length} záznamů${filterFaction ? " · " + factions[filterFaction]?.name : ""}</div>
      </div>
      <div class="filter-bar">
        <button class="filter-btn ${!filterFaction ? "active" : ""}" onclick="Wiki.renderPage('postavy')">Všechny</button>
        ${filters}
      </div>
      <div class="char-grid">
        ${chars.map(renderCharacterCard).join("")}
        ${newCard}
      </div>
    `;
  }

  function renderCharacterCard(c) {
    const overlay = EditMode.isActive() ? editOverlay(`#/postava/${c.id}`) : "";
    return `
      <a class="char-card" href="#/postava/${c.id}" style="text-decoration:none;position:relative">
        ${portraitWrap(c)}
        ${overlay}
        <div class="char-card-info">
          <div class="char-card-name">${c.knowledge >= 1 ? c.name : "???"}</div>
          <div class="char-card-title">${c.knowledge >= 2 ? c.title : "Neznámá"}</div>
          <div class="char-card-badges">${statusBadge(c.status)}</div>
        </div>
      </a>
    `;
  }

  // ══════════════════════════════════════════════════════════════
  //  CHARACTER ARTICLE
  // ══════════════════════════════════════════════════════════════
  function renderCharacterArticle(id) {
    if (id === "new") return EditMode.renderCharacterEditor(null);
    const c = Store.getCharacter(id);
    if (!c) return `<p>Postava '${id}' nenalezena.</p>`;
    if (EditMode.isActive()) return EditMode.renderCharacterEditor(c);

    // ── View mode ────────────────────────────────────────────────
    const rels   = Store.getRelationships().filter(r => r.source === id || r.target === id);
    const chars  = Store.getCharacters();
    const events = Store.getEvents();

    const knownFacts = c.knowledge >= 2 && (c.known||[]).length ? `
      <div class="char-section">
        <div class="char-section-title">Co víme</div>
        <div class="fact-list">
          ${c.known.map(f => `<div class="fact-item">${f}</div>`).join("")}
        </div>
      </div>` : "";

    const unknownFacts = (c.unknown||[]).length ? `
      <div class="char-section">
        <div class="char-section-title">Otevřené Otázky</div>
        <div class="fact-list">
          ${c.unknown.map(f => `<div class="unknown-item">${f}</div>`).join("")}
        </div>
      </div>` : "";

    const relChips = rels.length ? `
      <div class="char-section">
        <div class="char-section-title">Vazby</div>
        <div class="relation-chips">
          ${rels.map(r => {
            const otherId = r.source === id ? r.target : r.source;
            const other   = chars.find(ch => ch.id === otherId);
            if (!other) return "";
            const dir = r.source === id ? "→" : "←";
            return `<a class="relation-chip" href="#/postava/${otherId}">
              <span>${other.name}</span>
              <span class="chip-label">${dir} ${r.label || relationLabel(r.type)}</span>
            </a>`;
          }).join("")}
        </div>
      </div>` : "";

    const eventsInvolved = events.filter(e => (e.characters||[]).includes(id));
    const eventList = eventsInvolved.length ? `
      <div class="char-section">
        <div class="char-section-title">Zmínky v Událostech</div>
        <div class="fact-list">
          ${eventsInvolved.map(e =>
            `<div class="fact-item"><a class="wiki-link" href="#/udalost/${e.id}">${e.name}</a> — ${e.short}</div>`
          ).join("")}
        </div>
      </div>` : "";

    return `
      <button class="back-btn" onclick="history.back()">← Zpět</button>
      <div class="char-article">
        <div class="char-article-header">
          <div class="char-article-portrait-wrap">
            ${portraitWrap(c)}
          </div>
          <div class="char-article-meta">
            <div class="char-article-name">${c.knowledge >= 1 ? c.name : "Neznámá Postava"}</div>
            <div class="char-article-title-text">${c.knowledge >= 2 ? c.title : "—"}</div>
            <div class="char-article-badges">
              ${factionBadge(c.faction)}
              ${statusBadge(c.status)}
              ${knowledgeBadge(c.knowledge)}
            </div>
            <div class="char-article-desc">${c.knowledge >= 2 ? c.description : "<em>O této postavě toho víme jen velmi málo.</em>"}</div>
          </div>
        </div>
        ${knownFacts}${unknownFacts}${relChips}${eventList}
      </div>
    `;
  }

  // ══════════════════════════════════════════════════════════════
  //  LOCATION LIST & ARTICLE
  // ══════════════════════════════════════════════════════════════
  function renderLocationList() {
    const locations = Store.getLocations();
    const newBtn = EditMode.isActive() ? `
      <a href="#/misto/new" class="list-item-new" style="text-decoration:none">＋ Nové místo</a>` : "";

    return `
      <div class="page-header" style="display:flex;align-items:center;gap:1rem">
        <div style="flex:1">
          <h1>Místa</h1>
          <div class="subtitle">${locations.length} lokací</div>
        </div>
        ${newBtn}
      </div>
      <div class="list-items">
        ${locations.map(l => {
          const editBtn = EditMode.isActive()
            ? `<span class="list-edit-btn" title="Upravit">✏</span>` : "";
          return `<a class="list-item" href="#/misto/${l.id}" style="text-decoration:none;position:relative">
            <div style="display:flex;justify-content:space-between;align-items:flex-start">
              <div class="list-item-name">📍 ${l.name}</div>
              <div style="display:flex;align-items:center;gap:0.5rem">
                <span class="badge" style="background:rgba(255,255,255,0.07);color:var(--text-muted)">${l.type}</span>
                ${editBtn}
              </div>
            </div>
            <div class="list-item-sub">${l.status}</div>
            <div class="list-item-desc">${l.description.substring(0, 120)}…</div>
          </a>`;
        }).join("")}
      </div>
    `;
  }

  function renderLocationArticle(id) {
    if (id === "new") return EditMode.renderLocationEditor(null);
    const l = Store.getLocation(id);
    if (!l) return `<p>Místo '${id}' nenalezeno.</p>`;
    if (EditMode.isActive()) return EditMode.renderLocationEditor(l);

    const chars = (l.characters || []).map(cid => {
      const c = Store.getCharacter(cid);
      const factions = Store.getFactions();
      return c ? `<a class="relation-chip" href="#/postava/${cid}">${factions[c.faction]?.badge || "👤"} ${c.name}</a>` : "";
    }).join("");

    const inlineCreate = EditMode.isActive() ? `
      <div class="inline-create-row">
        <button class="inline-create-btn" onclick="EditMode.startNewCharacterInLocation('${l.id}')">＋ Postava zde</button>
        <button class="inline-create-btn" onclick="EditMode.startNewEvent({locations:['${l.id}']})">＋ Událost zde</button>
      </div>` : "";

    return `
      <button class="back-btn" onclick="history.back()">← Zpět</button>
      <div class="location-article">
        <div class="page-header">
          <h1>📍 ${l.name}</h1>
          <div class="subtitle">${l.type} · ${l.status}</div>
        </div>
        <p>${l.description}</p>
        ${l.notes ? `<div class="location-note">${l.notes}</div>` : ""}
        ${chars ? `<div class="char-section">
          <div class="char-section-title">Přítomné Postavy</div>
          <div class="relation-chips">${chars}</div>
        </div>` : ""}
        ${inlineCreate}
      </div>
    `;
  }

  // ══════════════════════════════════════════════════════════════
  //  EVENT LIST & ARTICLE
  // ══════════════════════════════════════════════════════════════
  function renderEventList() {
    const events = Store.getEvents();
    const newBtn = EditMode.isActive() ? `
      <a href="#/udalost/new" class="list-item-new" style="text-decoration:none">＋ Nová událost</a>` : "";

    return `
      <div class="page-header" style="display:flex;align-items:center;gap:1rem">
        <div style="flex:1">
          <h1>Časová Osa</h1>
          <div class="subtitle">Chronologie kampaně</div>
        </div>
        ${newBtn}
      </div>
      <div class="timeline">
        ${[...events].sort((a,b) => a.order - b.order).map(e => {
          const editBtn = EditMode.isActive()
            ? `<span class="list-edit-btn" title="Upravit" style="flex-shrink:0">✏</span>` : "";
          return `<div class="timeline-item">
            <div class="timeline-dot">${e.order}</div>
            <a class="timeline-content" href="#/udalost/${e.id}" style="text-decoration:none;display:flex;align-items:flex-start;gap:0.5rem">
              <div style="flex:1">
                <div class="timeline-event-name">${e.name}</div>
                <div class="timeline-event-short">${e.short}</div>
              </div>
              ${editBtn}
            </a>
          </div>`;
        }).join("")}
      </div>
    `;
  }

  function renderEventArticle(id) {
    if (id === "new") return EditMode.renderEventEditor(null);
    const e = Store.getEvent(id);
    if (!e) return `<p>Událost '${id}' nenalezena.</p>`;
    if (EditMode.isActive()) return EditMode.renderEventEditor(e);

    const chars = (e.characters || []).map(cid => {
      const c = Store.getCharacter(cid);
      return c ? `<a class="relation-chip" href="#/postava/${cid}">${c.name}</a>` : "";
    }).join("");

    const locs = (e.locations || []).map(lid => {
      const l = Store.getLocation(lid);
      return l ? `<a class="relation-chip" href="#/misto/${lid}">📍 ${l.name}</a>` : "";
    }).join("");

    const events = Store.getEvents();
    const next = e.consequence ? events.find(ev => ev.id === e.consequence) : null;

    return `
      <button class="back-btn" onclick="history.back()">← Zpět</button>
      <div class="location-article">
        <div class="page-header">
          <h1>${e.name}</h1>
          <div class="subtitle">Událost #${e.order}</div>
        </div>
        <p>${e.description}</p>
        ${chars ? `<div class="char-section"><div class="char-section-title">Zúčastněné Postavy</div><div class="relation-chips">${chars}</div></div>` : ""}
        ${locs  ? `<div class="char-section"><div class="char-section-title">Místa</div><div class="relation-chips">${locs}</div></div>` : ""}
        ${next  ? `<div class="char-section"><div class="char-section-title">Navazuje</div><div class="relation-chips">
          <a class="relation-chip" href="#/udalost/${next.id}">→ ${next.name}</a></div></div>` : ""}
      </div>
    `;
  }

  // ══════════════════════════════════════════════════════════════
  //  MYSTERIES LIST
  // ══════════════════════════════════════════════════════════════
  function renderMysteries() {
    const mysteries = Store.getMysteries();
    const sorted = [...mysteries].sort((a,b) => {
      const order = { kritická: 0, vysoká: 1, střední: 2 };
      return (order[a.priority] || 9) - (order[b.priority] || 9);
    });

    const newBtn = EditMode.isActive() ? `
      <a href="#/zahada/new" class="list-item-new" style="text-decoration:none">＋ Nová záhada</a>` : "";

    return `
      <div class="page-header" style="display:flex;align-items:center;gap:1rem">
        <div style="flex:1">
          <h1>❓ Záhady &amp; Otevřené Otázky</h1>
          <div class="subtitle">${mysteries.length} nevyřešených záhad</div>
        </div>
        ${newBtn}
      </div>
      <div class="mystery-list">
        ${sorted.map(m => {
          const editBtn = EditMode.isActive()
            ? `<a class="list-edit-btn" href="#/zahada/${m.id}" title="Upravit" style="float:right;margin-left:0.5rem">✏</a>` : "";
          return `<div class="mystery-card">
            <div class="mystery-name" style="display:flex;align-items:center;justify-content:space-between">
              <span>❓ ${m.name}</span>
              ${editBtn}
            </div>
            <div class="mystery-priority priority-${m.priority}">PRIORITA: ${m.priority.toUpperCase()}</div>
            <div class="mystery-desc" style="margin-top:0.5rem">${m.description}</div>
            ${(m.characters||[]).length ? `
              <div style="margin-top:0.75rem">
                <div class="char-section-title" style="font-size:0.7rem;margin-bottom:0.4rem">SPOJENÉ POSTAVY</div>
                <div class="relation-chips">
                  ${m.characters.map(cid => {
                    const c = Store.getCharacter(cid);
                    return c ? `<a class="relation-chip" href="#/postava/${cid}">${c.name}</a>` : "";
                  }).join("")}
                </div>
              </div>` : ""}
          </div>`;
        }).join("")}
      </div>
    `;
  }

  // ══════════════════════════════════════════════════════════════
  //  MYSTERY DETAIL / EDIT (route: #/zahada/{id})
  // ══════════════════════════════════════════════════════════════
  function renderMysteryArticle(id) {
    if (id === "new") return EditMode.renderMysteryEditor(null);
    const m = Store.getMystery(id);
    if (!m) return `<p>Záhada '${id}' nenalezena.</p>`;
    if (EditMode.isActive()) return EditMode.renderMysteryEditor(m);

    // View mode: expanded mystery card
    return `
      <button class="back-btn" onclick="history.back()">← Zpět</button>
      <div class="location-article">
        <div class="page-header">
          <h1>❓ ${m.name}</h1>
          <div class="subtitle mystery-priority priority-${m.priority}">PRIORITA: ${m.priority.toUpperCase()}</div>
        </div>
        <p>${m.description}</p>
        ${(m.characters||[]).length ? `
          <div class="char-section">
            <div class="char-section-title">Spojené Postavy</div>
            <div class="relation-chips">
              ${m.characters.map(cid => {
                const c = Store.getCharacter(cid);
                return c ? `<a class="relation-chip" href="#/postava/${cid}">${c.name}</a>` : "";
              }).join("")}
            </div>
          </div>` : ""}
        <div style="margin-top:1.5rem">
          <a href="#/zahady" class="wiki-link">← Zpět na seznam záhad</a>
        </div>
      </div>
    `;
  }

  // ══════════════════════════════════════════════════════════════
  //  FACTION LIST
  // ══════════════════════════════════════════════════════════════
  function renderFactionList() {
    const factions = Store.getFactions();
    const chars    = Store.getCharacters();

    const cards = Object.entries(factions).map(([id, f]) => {
      const memberCount = chars.filter(c => c.faction === id).length;
      const rankCount   = (f.rankChains || []).reduce((s, ch) => s + ch.ranks.length, 0);
      const ovl = EditMode.isActive() ? editOverlay(`#/frakce/${id}`) : "";
      return `
        <a class="faction-card" href="#/frakce/${id}" style="text-decoration:none;position:relative;border-color:${f.color}55">
          ${ovl}
          <div class="faction-card-header" style="background:${f.color}22;border-bottom:1px solid ${f.color}33">
            <span class="faction-card-badge">${f.badge}</span>
            <span class="faction-card-name" style="color:${f.textColor}">${f.name}</span>
          </div>
          <div class="faction-card-meta">
            <span>👤 ${memberCount} postav</span>
            ${rankCount ? `<span>⚔ ${rankCount} hodností</span>` : ""}
          </div>
        </a>`;
    }).join("");

    return `
      <div class="page-header" style="display:flex;align-items:center;gap:1rem">
        <div style="flex:1">
          <h1>⬡ Frakce</h1>
          <div class="subtitle">${Object.keys(factions).length} frakcí</div>
        </div>
        ${EditMode.isActive() ? `<a href="#/frakce/new" class="list-item-new" style="text-decoration:none">＋ Nová frakce</a>` : ""}
      </div>
      <div class="faction-grid">${cards}</div>
    `;
  }

  // ══════════════════════════════════════════════════════════════
  //  FACTION ARTICLE
  // ══════════════════════════════════════════════════════════════
  function renderFactionArticle(id) {
    if (id === "new") return EditMode.renderFactionEditor(null, "new");
    const factions = Store.getFactions();
    const f = factions[id];
    if (!f) return `<p>Frakce '${id}' nenalezena.</p>`;
    if (EditMode.isActive()) return EditMode.renderFactionEditor(f, id);

    const chars = Store.getCharacters().filter(c => c.faction === id);

    const chainSections = (f.rankChains || []).map(chain => {
      const chainMembers = chars.filter(c => c.rankChain === chain.id);
      const rankRows = chain.ranks.map((rank, ri) => {
        const ranked = chainMembers.filter(c => c.rank === rank);
        return `<div class="rank-row">
          <div class="rank-row-label">
            <span class="rank-dot" style="background:${f.color}">${ri + 1}</span>
            ${rank}
          </div>
          <div class="rank-row-members">
            ${ranked.length
              ? ranked.map(c => `<a class="relation-chip" href="#/postava/${c.id}">${c.name}</a>`).join("")
              : `<span style="font-size:0.75rem;opacity:0.5">Nikdo</span>`}
          </div>
        </div>`;
      }).join("");
      const unranked = chainMembers.filter(c => !chain.ranks.includes(c.rank));
      return `<div class="rank-chain">
        <div class="rank-chain-title">${chain.name}</div>
        ${rankRows}
        ${unranked.length ? `<div class="rank-row">
          <div class="rank-row-label"><span class="rank-dot" style="background:#555">?</span> Neznámá hodnost</div>
          <div class="rank-row-members">${unranked.map(c => `<a class="relation-chip" href="#/postava/${c.id}">${c.name}</a>`).join("")}</div>
        </div>` : ""}
      </div>`;
    }).join("");

    const unchained = chars.filter(c =>
      !c.rankChain || !(f.rankChains || []).find(ch => ch.id === c.rankChain)
    );

    const inlineCreate = EditMode.isActive() ? `
      <div class="inline-create-row">
        <button class="inline-create-btn" onclick="EditMode.startNewCharacter({faction:'${id}'})">＋ Nová postava ve frakci</button>
      </div>` : "";

    return `
      <button class="back-btn" onclick="history.back()">← Zpět</button>
      <div class="location-article">
        <div class="faction-article-header" style="border:1px solid ${f.color}44;background:${f.color}11">
          <span class="faction-article-badge">${f.badge}</span>
          <div>
            <h1 style="margin:0;color:${f.textColor}">${f.name}</h1>
            <div class="subtitle">${chars.length} postav</div>
          </div>
        </div>
        ${inlineCreate}
        ${f.description ? `<p style="margin-top:1rem">${f.description}</p>` : ""}
        ${(f.rankChains || []).length ? `
          <div class="char-section" style="margin-top:1.5rem">
            <div class="char-section-title">Hodnostní Řetězce</div>
            ${chainSections}
          </div>` : ""}
        ${unchained.length ? `
          <div class="char-section">
            <div class="char-section-title">Členové</div>
            <div class="relation-chips">
              ${unchained.map(c => `<a class="relation-chip" href="#/postava/${c.id}">${c.name}</a>`).join("")}
            </div>
          </div>` : ""}
        <div style="margin-top:1.5rem">
          <a href="#/frakce" class="wiki-link">← Zpět na frakce</a>
        </div>
      </div>
    `;
  }

  // ── Public API ─────────────────────────────────────────────────
  function renderPage(page, param) {
    const el = document.getElementById("main-content");
    if (!el) return;

    let html = "";
    switch (page) {
      case "dashboard":  html = renderDashboard(); break;
      case "postavy":    html = renderCharacterList(param); break;
      case "postava":    html = renderCharacterArticle(param); break;
      case "mista":      html = renderLocationList(); break;
      case "misto":      html = renderLocationArticle(param); break;
      case "udalosti":   html = renderEventList(); break;
      case "udalost":    html = renderEventArticle(param); break;
      case "zahady":     html = renderMysteries(); break;
      case "zahada":     html = renderMysteryArticle(param); break;
      case "frakce":     html = renderFactionList(); break;
      case "frakce-id":  html = renderFactionArticle(param); break;
      default:           html = renderDashboard();
    }
    el.innerHTML = html;
    el.scrollTop = 0;
    window.scrollTo(0, 0);
  }

  return { renderPage };
})();
