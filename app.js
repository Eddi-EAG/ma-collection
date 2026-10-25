// Collection de montres — interface (sans framework, sans étape de build).
// Les données sont stockées sur l'appareil via store.js : l'app marche hors ligne.

import { Store, localIsoDate } from "./store.js";

const $app = document.getElementById("app");
const $modal = document.getElementById("modal");
const $toast = document.getElementById("toast");

// --- Référentiels -----------------------------------------------------------

const MOVEMENT_TYPES = ["Automatique", "Remontage manuel", "Quartz", "Solaire", "Méca-quartz", "Spring Drive", "Kinetic"];
const CONDITIONS = ["Neuve", "Occasion", "Vintage"];
const CASE_MATERIALS = ["Acier", "Titane", "Bronze", "Or jaune", "Or rose", "Or blanc", "Platine", "Céramique", "Carbone", "Laiton"];
const CRYSTALS = ["Saphir", "Minéral", "Hésalite", "Plexiglas"];
const SERVICE_TYPES = [
  "Révision complète", "Changement de pile", "Contrôle d'étanchéité", "Réglage / régulation",
  "Changement de joints", "Polissage", "Réparation", "Changement de bracelet", "Autre",
];
const PRIORITIES = { 1: "Coup de cœur", 2: "Envie", 3: "Un jour peut-être" };
const STATUS_LABELS = {
  overdue: "Révision en retard",
  soon: "Révision à prévoir",
  ok: "Entretien à jour",
  unknown: "Entretien non renseigné",
};
const BACKUP_REMINDER_DAYS = 30;

// Sections de la fiche montre : servent à la fois au formulaire et à l'affichage.
const WATCH_SECTIONS = [
  { title: "Identité", fields: [
    { name: "brand", label: "Marque" },
    { name: "model", label: "Modèle" },
    { name: "reference", label: "Référence" },
    { name: "serial_number", label: "N° de série" },
    { name: "year", label: "Année", type: "number" },
  ]},
  { title: "Mouvement", fields: [
    { name: "movement_type", label: "Type", options: MOVEMENT_TYPES },
    { name: "caliber", label: "Calibre", placeholder: "ex. ETA 2824-2" },
    { name: "power_reserve_h", label: "Réserve de marche", type: "number", unit: "h" },
    { name: "frequency_bph", label: "Fréquence", type: "number", unit: "alt/h", placeholder: "28800" },
    { name: "jewels", label: "Rubis", type: "number" },
    { name: "complications", label: "Complications", placeholder: "Date, GMT, chronographe…" },
  ]},
  { title: "Boîtier & habillage", fields: [
    { name: "case_diameter_mm", label: "Diamètre", type: "number", unit: "mm", step: "0.1" },
    { name: "case_thickness_mm", label: "Épaisseur", type: "number", unit: "mm", step: "0.1" },
    { name: "lug_width_mm", label: "Entre-cornes", type: "number", unit: "mm", step: "0.5" },
    { name: "lug_to_lug_mm", label: "Lug-to-lug", type: "number", unit: "mm", step: "0.1" },
    { name: "case_material", label: "Matière du boîtier", list: CASE_MATERIALS },
    { name: "crystal", label: "Verre", list: CRYSTALS },
    { name: "water_resistance_m", label: "Étanchéité", type: "number", unit: "m" },
    { name: "dial_color", label: "Cadran" },
    { name: "bezel", label: "Lunette" },
    { name: "strap", label: "Bracelet", wide: true },
  ]},
  { title: "Achat & valeur", fields: [
    { name: "purchase_date", label: "Date d'achat", type: "date" },
    { name: "purchase_price", label: "Prix d'achat", type: "number", unit: "€", step: "0.01" },
    { name: "purchase_place", label: "Lieu d'achat" },
    { name: "condition", label: "État à l'achat", options: CONDITIONS },
    { name: "estimated_value", label: "Valeur estimée", type: "number", unit: "€", step: "0.01" },
    { name: "box_papers", label: "Boîte & papiers", type: "checkbox" },
  ]},
  { title: "Entretien", fields: [
    { name: "service_interval_years", label: "Révision tous les", type: "number", unit: "ans", step: "0.5", placeholder: "5" },
  ]},
  { title: "Notes", fields: [
    { name: "notes", label: "Notes personnelles", type: "textarea", wide: true },
  ]},
];

const WATCH_ICON = `<svg class="placeholder" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
  <rect x="22" y="2" width="20" height="12" rx="2"/><rect x="22" y="50" width="20" height="12" rx="2"/>
  <circle cx="32" cy="32" r="19"/><path d="M32 20v12l7 5" stroke-linecap="round"/></svg>`;

// --- Utilitaires ------------------------------------------------------------

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const euro = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const fmtMoney = (v) => (v == null ? "—" : euro.format(v));
const fmtNum = (v) => new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 }).format(v);
const fmtDate = (iso, opts = { day: "numeric", month: "long", year: "numeric" }) =>
  iso ? new Date(iso.slice(0, 10) + "T12:00:00").toLocaleDateString("fr-FR", opts) : "—";
const today = () => localIsoDate();
const daysSince = (iso) => Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);

function fmtRelative(days) {
  const rtf = new Intl.RelativeTimeFormat("fr", { numeric: "auto" });
  const abs = Math.abs(days);
  if (abs < 45) return rtf.format(days, "day");
  if (abs < 540) return rtf.format(Math.round(days / 30.4), "month");
  return rtf.format(Math.round(days / 365.25), "year");
}

const watchName = (w) => [w.brand, w.model].filter(Boolean).join(" ") || "Sans nom";

const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isInstalled = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;

function toastUpload(okMessage, skipped) {
  if (skipped.length) toast(`Format d'image non lisible : ${skipped.join(", ")}`, true);
  else toast(okMessage);
}

// Enveloppe un gestionnaire d'événement : toute erreur s'affiche en notification.
const guard = (fn) => async (...args) => {
  try {
    await fn(...args);
  } catch (err) {
    toast(err.message, true);
  }
};

// N'accepte que des liens web ; ajoute https:// si l'adresse n'a pas de protocole.
function safeUrl(value) {
  const s = (value || "").trim();
  if (!s) return "";
  const full = /^[a-z][a-z0-9+.-]*:/i.test(s) ? s : `https://${s}`;
  return /^https?:\/\//i.test(full) ? full : "";
}

let toastTimer;
function toast(message, isError = false) {
  $toast.textContent = message;
  $toast.className = `toast show${isError ? " error" : ""}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($toast.className = "toast"), isError ? 4500 : 2600);
}

function formValues(form) {
  const out = {};
  for (const el of form.elements) {
    if (!el.name || el.type === "file") continue;
    out[el.name] = el.type === "checkbox" ? (el.checked ? 1 : 0) : el.value;
  }
  return out;
}

function fieldHtml(f, value) {
  const id = `f-${f.name}`;
  const v = value ?? "";
  const cls = `field${f.wide ? " wide" : ""}`;
  if (f.type === "checkbox") {
    return `<div class="${cls} check"><input type="checkbox" id="${id}" name="${f.name}" ${value ? "checked" : ""}><label for="${id}">${f.label}</label></div>`;
  }
  if (f.type === "textarea") {
    return `<div class="${cls}"><label for="${id}">${f.label}</label><textarea id="${id}" name="${f.name}" placeholder="${esc(f.placeholder)}">${esc(v)}</textarea></div>`;
  }
  if (f.options) {
    const opts = Object.entries(Array.isArray(f.options) ? Object.fromEntries(f.options.map((o) => [o, o])) : f.options)
      .map(([val, label]) => `<option value="${esc(val)}" ${String(v) === String(val) ? "selected" : ""}>${esc(label)}</option>`).join("");
    return `<div class="${cls}"><label for="${id}">${f.label}</label><select id="${id}" name="${f.name}">${f.noEmpty ? "" : '<option value="">—</option>'}${opts}</select></div>`;
  }
  const listId = f.list ? `list-${f.name}` : "";
  const datalist = f.list ? `<datalist id="${listId}">${f.list.map((o) => `<option value="${esc(o)}">`).join("")}</datalist>` : "";
  const numeric = f.type === "number" ? `inputmode="decimal"` : "";
  const input = `<input id="${id}" name="${f.name}" type="${f.type || "text"}" value="${esc(v)}" ${numeric}
    ${f.step ? `step="${f.step}"` : f.type === "number" ? 'step="any"' : ""} ${f.list ? `list="${listId}"` : ""}
    ${f.required ? "required" : ""} placeholder="${esc(f.placeholder)}">`;
  const body = f.unit ? `<div class="unit-wrap">${input}<span class="unit">${f.unit}</span></div>` : input;
  return `<div class="${cls}"><label for="${id}">${f.label}</label>${body}${datalist}</div>`;
}

function displayValue(f, v) {
  if (v == null || v === "") return null;
  if (f.type === "checkbox") return v ? "Oui" : "Non";
  if (f.type === "date") return fmtDate(v);
  if (f.unit === "€") return fmtMoney(v);
  if (f.name === "frequency_bph") return `${fmtNum(v)} alt/h · ${fmtNum(v / 7200)} Hz`;
  if (f.name === "year") return String(v);
  if (f.type === "number") return `${fmtNum(v)}${f.unit ? ` ${f.unit}` : ""}`;
  return esc(v);
}

function openModal(html) {
  $modal.innerHTML = `<div class="modal-body">${html}</div>`;
  $modal.showModal();
  $modal.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", () => $modal.close()));
}

$modal.addEventListener("click", (e) => { if (e.target === $modal) $modal.close(); });

// Bandeaux d'aide affichés en haut de la collection.
async function noticesHtml(hasWatches) {
  const notices = [];
  if (isIOS && !isInstalled()) {
    notices.push(`<strong>Installe l'app sur ton iPhone</strong> pour qu'elle marche hors ligne et que tes données soient bien conservées :
      dans Safari, touche <em>Partager</em> puis <em>Sur l'écran d'accueil</em>.`);
  }
  if (hasWatches) {
    const last = await Store.getMeta("last_backup");
    if (!last || daysSince(last) > BACKUP_REMINDER_DAYS) {
      notices.push(`${last ? `Dernière sauvegarde ${fmtRelative(-daysSince(last))}.` : "Ta collection n'a jamais été sauvegardée."}
        Tes données ne sont que sur cet appareil : <a href="#/sauvegarde">fais une sauvegarde</a>.`);
    }
  }
  return notices.map((n) => `<div class="notice">${n}</div>`).join("");
}

// --- Pages ------------------------------------------------------------------

const state = { filters: { q: "", movement: "", sort: "brand" } };

async function pageCollection() {
  const token = renderId;
  const watches = await Store.listWatches();
  const notices = await noticesHtml(watches.length > 0);
  if (token !== renderId) return;
  const f = state.filters;

  const totalPrice = watches.reduce((s, w) => s + (w.purchase_price || 0), 0);
  const withEstimate = watches.filter((w) => w.estimated_value != null);
  const totalEstimate = watches.reduce((s, w) => s + (w.estimated_value ?? w.purchase_price ?? 0), 0);
  const toService = watches.filter((w) => ["soon", "overdue"].includes(w.maintenance.status)).length;

  $app.innerHTML = `
    ${notices}
    <div class="page-head">
      <div><div class="eyebrow">Registre</div><h1>La collection</h1></div>
      <a class="btn btn-primary" href="#/montre/nouvelle">+ Ajouter une montre</a>
    </div>
    ${watches.length ? `
    <div class="stats">
      <div class="stat"><div class="stat-value">${watches.length}</div><div class="stat-label">Montre${watches.length > 1 ? "s" : ""}</div></div>
      <div class="stat"><div class="stat-value">${fmtMoney(totalPrice)}</div><div class="stat-label">Valeur d'achat</div></div>
      ${withEstimate.length ? `<div class="stat"><div class="stat-value">${fmtMoney(totalEstimate)}</div><div class="stat-label">Valeur estimée</div></div>` : ""}
      <div class="stat"><div class="stat-value">${toService}</div><div class="stat-label">Révision${toService > 1 ? "s" : ""} à prévoir</div></div>
    </div>
    <div class="toolbar">
      <input class="search" type="search" id="q" placeholder="Rechercher une marque, un modèle, un calibre…" value="${esc(f.q)}">
      <select id="movement" aria-label="Type de mouvement">
        <option value="">Tous les mouvements</option>
        ${MOVEMENT_TYPES.map((m) => `<option ${f.movement === m ? "selected" : ""}>${m}</option>`).join("")}
      </select>
      <select id="sort" aria-label="Trier">
        <option value="brand" ${f.sort === "brand" ? "selected" : ""}>Trier par marque</option>
        <option value="recent" ${f.sort === "recent" ? "selected" : ""}>Achat le plus récent</option>
        <option value="value" ${f.sort === "value" ? "selected" : ""}>Valeur décroissante</option>
        <option value="size" ${f.sort === "size" ? "selected" : ""}>Diamètre</option>
      </select>
    </div>
    <div class="grid" id="grid"></div>` : `
    <div class="empty">
      <h2>Le coffre est vide</h2>
      <p>Ajoute ta première montre pour commencer ton registre.</p>
      <div class="btn-row" style="justify-content:center;margin-top:18px">
        <a class="btn btn-primary" href="#/montre/nouvelle">+ Ajouter une montre</a>
        <a class="btn btn-ghost" href="#/sauvegarde">Restaurer une sauvegarde</a>
      </div>
    </div>`}`;

  if (!watches.length) return;

  const renderGrid = () => {
    const q = f.q.trim().toLowerCase();
    let list = watches.filter((w) =>
      (!f.movement || w.movement_type === f.movement) &&
      (!q || [w.brand, w.model, w.reference, w.caliber, w.dial_color].some((v) => (v || "").toLowerCase().includes(q))));
    const sorters = {
      brand: (a, b) => watchName(a).localeCompare(watchName(b), "fr"),
      recent: (a, b) => (b.purchase_date || "").localeCompare(a.purchase_date || ""),
      value: (a, b) => (b.estimated_value ?? b.purchase_price ?? 0) - (a.estimated_value ?? a.purchase_price ?? 0),
      size: (a, b) => (a.case_diameter_mm ?? 999) - (b.case_diameter_mm ?? 999),
    };
    list = list.sort(sorters[f.sort]);
    document.getElementById("grid").innerHTML = list.length ? list.map(watchCard).join("") :
      `<p class="muted">Aucune montre ne correspond à ces filtres.</p>`;
  };

  document.getElementById("q").addEventListener("input", (e) => { f.q = e.target.value; renderGrid(); });
  document.getElementById("movement").addEventListener("change", (e) => { f.movement = e.target.value; renderGrid(); });
  document.getElementById("sort").addEventListener("change", (e) => { f.sort = e.target.value; renderGrid(); });
  renderGrid();
}

function watchCard(w) {
  const meta = [w.reference, w.movement_type, w.case_diameter_mm && `${fmtNum(w.case_diameter_mm)} mm`].filter(Boolean).map(esc).join(" · ");
  return `
    <a class="card" href="#/montre/${w.id}">
      <div class="card-media">${w.cover ? `<img src="${w.cover}" alt="" loading="lazy">` : WATCH_ICON}</div>
      <div>
        <div class="card-brand">${esc(w.brand || "—")}</div>
        <div class="card-title">${esc(w.model || "Sans modèle")}</div>
        ${meta ? `<div class="card-meta">${meta}</div>` : ""}
      </div>
      <div class="card-foot"><span class="badge ${w.maintenance.status}">${STATUS_LABELS[w.maintenance.status]}</span></div>
    </a>`;
}

async function pageWatch(id) {
  const token = renderId;
  const w = await Store.getWatch(id);
  if (token !== renderId) return;
  const m = w.maintenance;
  let current = 0;

  const sections = WATCH_SECTIONS.filter((s) => !["Identité", "Notes", "Entretien"].includes(s.title)).map((s) => {
    const rows = s.fields.map((f) => [f, displayValue(f, w[f.name])]).filter(([, v]) => v != null);
    if (!rows.length) return "";
    return `<section class="spec-section"><h2>${s.title}</h2><dl class="specs">
      ${rows.map(([f, v]) => `<div class="spec"><dt>${f.label}</dt><dd>${v}</dd></div>`).join("")}</dl></section>`;
  }).join("");

  const identity = [["N° de série", w.serial_number], ["Année", w.year]].filter(([, v]) => v);

  $app.innerHTML = `
    <a class="back" href="#/">← La collection</a>
    <div class="detail">
      <div>
        <div class="gallery-main" id="main-photo"></div>
        <div class="thumbs" id="thumbs"></div>
      </div>
      <div>
        <div class="detail-title">
          <div class="card-brand">${esc(w.brand || "—")}</div>
          <h1>${esc(w.model || "Sans modèle")}</h1>
          <div class="detail-ref">${[w.reference && `Réf. ${esc(w.reference)}`, ...identity.map(([k, v]) => `${k} ${esc(v)}`)].filter(Boolean).join(" · ")}</div>
        </div>
        <div class="btn-row detail-actions">
          <a class="btn" href="#/montre/${w.id}/modifier">Modifier la fiche</a>
          <button class="btn btn-ghost btn-danger" id="del-watch">Supprimer</button>
        </div>

        ${sections}

        ${w.notes ? `<section class="spec-section"><h2>Notes</h2><p class="notes">${esc(w.notes)}</p></section>` : ""}

        <section class="spec-section" id="entretien">
          <h2>Entretien</h2>
          <div class="service-due ${m.status}">
            <span class="badge ${m.status}">${STATUS_LABELS[m.status]}</span>
            ${m.next_due ? `
              <div class="service-due-date">Révision ${m.status === "overdue" ? "prévue" : "suivante"} : ${fmtDate(m.next_due, { month: "long", year: "numeric" })}</div>
              <div class="muted">${fmtRelative(m.days_left)} — calculée depuis ${m.base_label === "achat" ? "l'achat" : "la dernière révision complète"} (${fmtDate(m.base)}) + ${fmtNum(m.interval_years)} ans</div>` : `
              <div class="muted" style="margin-top:6px">Renseigne la date d'achat ou ajoute une révision complète pour calculer la prochaine échéance.</div>`}
          </div>

          <form class="inline-form" id="service-form">
            <div class="section-title" style="border:0;padding:0">Ajouter une intervention</div>
            <div class="form-grid">
              ${fieldHtml({ name: "date", label: "Date", type: "date" }, today())}
              ${fieldHtml({ name: "type", label: "Type", options: SERVICE_TYPES, noEmpty: true }, "Révision complète")}
              ${fieldHtml({ name: "provider", label: "Horloger / SAV" })}
              ${fieldHtml({ name: "cost", label: "Coût", type: "number", unit: "€", step: "0.01" })}
              ${fieldHtml({ name: "notes", label: "Détails", wide: true, placeholder: "Pièces changées, écart mesuré, garantie…" })}
            </div>
            <div class="btn-row" style="margin-top:14px;justify-content:flex-end"><button class="btn btn-primary" type="submit">Enregistrer l'intervention</button></div>
          </form>

          ${w.services.length ? `
            <ul class="timeline">
              ${w.services.map((s) => `
                <li>
                  <div class="timeline-date">${fmtDate(s.date, { day: "numeric", month: "short", year: "numeric" })}</div>
                  <div>
                    <div class="timeline-type">${esc(s.type)}</div>
                    ${s.provider ? `<div class="muted" style="font-size:13px">${esc(s.provider)}</div>` : ""}
                    ${s.notes ? `<div class="timeline-notes">${esc(s.notes)}</div>` : ""}
                  </div>
                  <div class="timeline-side">
                    <span>${s.cost != null ? fmtMoney(s.cost) : ""}</span>
                    <button class="btn btn-ghost btn-sm" data-del-service="${s.id}">Supprimer</button>
                  </div>
                </li>`).join("")}
            </ul>
            ${w.service_total ? `<p class="muted" style="text-align:right;font-size:13px">Total des frais d'entretien : <strong style="color:var(--ink)">${fmtMoney(w.service_total)}</strong></p>` : ""}` :
            `<p class="muted" style="margin-top:14px">Aucune intervention enregistrée pour l'instant.</p>`}
        </section>
      </div>
    </div>`;

  const renderGallery = () => {
    const main = document.getElementById("main-photo");
    const p = w.photos[current];
    main.innerHTML = p ? `<img src="${p.url}" alt="${esc(watchName(w))}">` : WATCH_ICON;
    document.getElementById("thumbs").innerHTML = w.photos.map((ph, i) => `
      <div class="thumb-wrap">
        <button class="thumb ${i === current ? "active" : ""}" data-thumb="${i}" title="Voir"><img src="${ph.thumb}" alt=""></button>
        <button class="thumb-del" data-del-photo="${ph.id}" title="Supprimer la photo">×</button>
      </div>`).join("") + `
      <label class="add-photo" title="Ajouter des photos">+<input type="file" id="photo-input" accept="image/*" multiple hidden></label>`;
  };
  renderGallery();

  document.getElementById("thumbs").addEventListener("click", guard(async (e) => {
    const t = e.target.closest("[data-thumb]");
    if (t) { current = Number(t.dataset.thumb); renderGallery(); return; }
    const d = e.target.closest("[data-del-photo]");
    if (d && confirm("Supprimer cette photo ?")) {
      await Store.deletePhoto(d.dataset.delPhoto);
      toast("Photo supprimée");
      render();
    }
  }));
  document.getElementById("thumbs").addEventListener("change", guard(async (e) => {
    if (e.target.id !== "photo-input") return;
    toast("Ajout des photos…");
    toastUpload("Photos ajoutées", await Store.addPhotos({ watch_id: id }, e.target.files));
    render();
  }));

  document.getElementById("del-watch").addEventListener("click", guard(async () => {
    if (!confirm(`Supprimer définitivement « ${watchName(w)} » et tout son historique ?`)) return;
    await Store.deleteWatch(id);
    toast("Montre supprimée");
    location.hash = "#/";
  }));

  document.getElementById("service-form").addEventListener("submit", guard(async (e) => {
    e.preventDefault();
    await Store.createService(id, formValues(e.target));
    toast("Intervention enregistrée");
    await render();
    document.getElementById("entretien")?.scrollIntoView({ block: "start" });
  }));

  $app.querySelectorAll("[data-del-service]").forEach((b) => b.addEventListener("click", guard(async () => {
    if (!confirm("Supprimer cette intervention ?")) return;
    await Store.deleteService(b.dataset.delService);
    toast("Intervention supprimée");
    render();
  })));
}

async function pageWatchForm(id) {
  const token = renderId;
  const w = id ? await Store.getWatch(id) : {};
  if (token !== renderId) return;
  $app.innerHTML = `
    <a class="back" href="${id ? `#/montre/${id}` : "#/"}">← ${id ? esc(watchName(w)) : "La collection"}</a>
    <div class="page-head"><div><div class="eyebrow">${id ? "Modifier" : "Nouvelle entrée"}</div><h1>${id ? esc(watchName(w)) : "Ajouter une montre"}</h1></div></div>
    <form id="watch-form">
      ${WATCH_SECTIONS.map((s) => `
        <section class="form-section">
          <h2 class="section-title">${s.title}</h2>
          <div class="form-grid">${s.fields.map((f) => fieldHtml(f, w[f.name])).join("")}</div>
        </section>`).join("")}
      ${id ? "" : `
        <section class="form-section">
          <h2 class="section-title">Photos</h2>
          <div class="form-grid"><div class="field wide"><input type="file" id="new-photos" accept="image/*" multiple class="file-input"></div></div>
        </section>`}
      <div class="form-actions">
        <a class="btn btn-ghost" href="${id ? `#/montre/${id}` : "#/"}">Annuler</a>
        <button class="btn btn-primary" type="submit">${id ? "Enregistrer" : "Ajouter à la collection"}</button>
      </div>
    </form>`;

  document.getElementById("watch-form").addEventListener("submit", guard(async (e) => {
    e.preventDefault();
    const data = formValues(e.target);
    if (id) {
      await Store.updateWatch(id, data);
      toast("Fiche mise à jour");
      location.hash = `#/montre/${id}`;
      return;
    }
    const files = document.getElementById("new-photos").files;
    const watchId = await Store.createWatch(data);
    // La montre existe désormais : on va sur sa fiche même si une photo échoue,
    // sinon un second appui sur « Ajouter » créerait un doublon.
    location.hash = `#/montre/${watchId}`;
    if (files.length) toast("Ajout des photos…");
    toastUpload("Montre ajoutée à la collection", await Store.addPhotos({ watch_id: watchId }, files));
    render();
  }));
}

async function pageMaintenance() {
  const token = renderId;
  const items = await Store.maintenanceOverview();
  if (token !== renderId) return;
  const count = (s) => items.filter((w) => w.maintenance.status === s).length;

  $app.innerHTML = `
    <div class="page-head">
      <div><div class="eyebrow">Atelier</div><h1>Suivi d'entretien</h1>
      <p class="lede">Échéances calculées depuis la dernière révision complète (ou l'achat) et l'intervalle propre à chaque montre.</p></div>
    </div>
    ${items.length ? `
    <div class="stats">
      <div class="stat"><div class="stat-value" style="color:var(--danger)">${count("overdue")}</div><div class="stat-label">En retard</div></div>
      <div class="stat"><div class="stat-value" style="color:var(--warn)">${count("soon")}</div><div class="stat-label">Dans les 6 mois</div></div>
      <div class="stat"><div class="stat-value" style="color:var(--ok)">${count("ok")}</div><div class="stat-label">À jour</div></div>
      <div class="stat"><div class="stat-value">${count("unknown")}</div><div class="stat-label">Non renseignées</div></div>
    </div>
    <div class="table-wrap"><table class="table">
      <thead><tr><th>Montre</th><th class="hide-sm">Dernière intervention</th><th>Prochaine révision</th><th class="hide-sm">Statut</th></tr></thead>
      <tbody>
        ${items.map((w) => `
          <tr class="clickable" data-href="#/montre/${w.id}">
            <td><div class="watch-cell">
              ${w.cover ? `<img class="mini" src="${w.cover}" alt="">` : `<span class="mini"></span>`}
              <div><div class="card-brand">${esc(w.brand || "—")}</div><div>${esc(w.model || "")}</div></div>
            </div></td>
            <td class="hide-sm">${w.last_service ? `${esc(w.last_service.type)}<div class="muted" style="font-size:13px">${fmtDate(w.last_service.date)}</div>` : `<span class="muted">—</span>`}</td>
            <td>${w.maintenance.next_due ? `${fmtDate(w.maintenance.next_due, { month: "short", year: "numeric" })}<div class="muted" style="font-size:13px">${fmtRelative(w.maintenance.days_left)}</div>` : `<span class="muted">—</span>`}
              <div class="show-sm"><span class="badge ${w.maintenance.status}">${STATUS_LABELS[w.maintenance.status]}</span></div></td>
            <td class="hide-sm"><span class="badge ${w.maintenance.status}">${STATUS_LABELS[w.maintenance.status]}</span></td>
          </tr>`).join("")}
      </tbody>
    </table></div>` : `
    <div class="empty"><h2>Rien à entretenir</h2><p>Ajoute des montres à ta collection pour suivre leurs révisions.</p></div>`}`;

  $app.querySelectorAll("tr[data-href]").forEach((tr) => tr.addEventListener("click", () => (location.hash = tr.dataset.href)));
}

async function pageWishlist() {
  const token = renderId;
  const items = await Store.listWishlist();
  if (token !== renderId) return;
  const total = items.reduce((s, w) => s + (w.target_price || 0), 0);

  $app.innerHTML = `
    <div class="page-head">
      <div><div class="eyebrow">Convoitises</div><h1>Wishlist</h1>
      ${items.length ? `<p class="lede">${items.length} montre${items.length > 1 ? "s" : ""} en vue · budget cible ${fmtMoney(total)}</p>` : ""}</div>
      <button class="btn btn-primary" id="add-wish">+ Ajouter une envie</button>
    </div>
    ${items.length ? `<div class="grid">${items.map(wishCard).join("")}</div>` : `
    <div class="empty"><h2>Aucune envie pour l'instant</h2><p>Note ici les montres que tu guettes, avec ton prix cible.</p></div>`}`;

  document.getElementById("add-wish").addEventListener("click", () => wishModal());
  $app.querySelectorAll("[data-edit-wish]").forEach((b) =>
    b.addEventListener("click", () => wishModal(items.find((w) => w.id === Number(b.dataset.editWish)))));
  $app.querySelectorAll("[data-acquire]").forEach((b) =>
    b.addEventListener("click", () => acquireModal(items.find((w) => w.id === Number(b.dataset.acquire)))));
}

function wishCard(w) {
  const inBudget = w.current_price != null && w.target_price != null && w.current_price <= w.target_price;
  const link = safeUrl(w.link);
  return `
    <div class="card">
      <div class="card-media">
        ${w.cover ? `<img src="${w.cover}" alt="" loading="lazy">` : WATCH_ICON}
        <span class="card-tag">${PRIORITIES[w.priority] || PRIORITIES[2]}</span>
      </div>
      <div>
        <div class="card-brand">${esc(w.brand || "—")}</div>
        <div class="card-title">${esc(w.model || "Sans modèle")}</div>
        ${w.reference ? `<div class="card-meta">Réf. ${esc(w.reference)}</div>` : ""}
      </div>
      <div class="prices">
        <div><span>Prix cible</span><strong>${fmtMoney(w.target_price)}</strong></div>
        <div><span>Prix vu</span><strong>${fmtMoney(w.current_price)}</strong></div>
      </div>
      ${inBudget ? `<div class="in-budget">● Dans le budget</div>` : ""}
      ${w.notes ? `<div class="card-meta">${esc(w.notes)}</div>` : ""}
      <div class="card-actions">
        <button class="btn btn-sm" data-edit-wish="${w.id}">Modifier</button>
        <button class="btn btn-sm" data-acquire="${w.id}">Je l'ai achetée</button>
        ${link ? `<a class="btn btn-sm btn-ghost" href="${esc(link)}" target="_blank" rel="noopener">Annonce ↗</a>` : ""}
      </div>
    </div>`;
}

function wishModal(w = {}) {
  const fields = [
    { name: "brand", label: "Marque" },
    { name: "model", label: "Modèle" },
    { name: "reference", label: "Référence" },
    { name: "priority", label: "Priorité", options: PRIORITIES, noEmpty: true },
    { name: "target_price", label: "Prix cible", type: "number", unit: "€", step: "0.01" },
    { name: "current_price", label: "Prix constaté", type: "number", unit: "€", step: "0.01" },
    { name: "link", label: "Lien (annonce, boutique…)", wide: true, placeholder: "chrono24.fr/…" },
    { name: "notes", label: "Notes", type: "textarea", wide: true },
  ];
  openModal(`
    <div class="eyebrow">Wishlist</div>
    <h2>${w.id ? esc(watchName(w)) : "Nouvelle envie"}</h2>
    <form id="wish-form">
      <div class="form-grid">
        ${fields.map((f) => fieldHtml(f, w[f.name] ?? (f.name === "priority" ? 2 : ""))).join("")}
        <div class="field wide"><label>Photos</label>
          ${w.photos?.length ? `<div class="thumbs" style="margin:0 0 8px">${w.photos.map((p) => `
            <div class="thumb-wrap"><span class="thumb"><img src="${p.thumb}" alt=""></span>
            <button type="button" class="thumb-del" style="display:block" data-del-photo="${p.id}" title="Supprimer">×</button></div>`).join("")}</div>` : ""}
          <input type="file" id="wish-photos" accept="image/*" multiple class="file-input">
        </div>
      </div>
      <div class="modal-actions">
        ${w.id ? `<button type="button" class="btn btn-ghost btn-danger" id="del-wish">Retirer</button>` : ""}
        <div class="btn-row">
          <button type="button" class="btn btn-ghost" data-close>Annuler</button>
          <button type="submit" class="btn btn-primary">${w.id ? "Enregistrer" : "Ajouter"}</button>
        </div>
      </div>
    </form>`);

  // Une photo supprimée dans la fenêtre l'est tout de suite :
  // on rafraîchit la page à la fermeture, même sur « Annuler ».
  $modal.addEventListener("close", () => render(), { once: true });

  const form = document.getElementById("wish-form");
  let wishId = w.id;
  form.addEventListener("submit", guard(async (e) => {
    e.preventDefault();
    // Après un premier enregistrement réussi, un nouvel essai met à jour au lieu de recréer.
    if (wishId) await Store.updateWish(wishId, formValues(form));
    else wishId = await Store.createWish(formValues(form));
    const skipped = await Store.addPhotos({ wish_id: wishId }, document.getElementById("wish-photos").files);
    $modal.close();
    toastUpload(w.id ? "Envie mise à jour" : "Ajoutée à la wishlist", skipped);
  }));
  form.querySelectorAll("[data-del-photo]").forEach((b) => b.addEventListener("click", guard(async () => {
    await Store.deletePhoto(b.dataset.delPhoto);
    b.parentElement.remove();
  })));
  document.getElementById("del-wish")?.addEventListener("click", guard(async () => {
    if (!confirm(`Retirer « ${watchName(w)} » de la wishlist ?`)) return;
    await Store.deleteWish(w.id);
    $modal.close();
    toast("Retirée de la wishlist");
  }));
}

function acquireModal(w) {
  openModal(`
    <div class="eyebrow">Félicitations</div>
    <h2>${esc(watchName(w))} rejoint la collection</h2>
    <p class="muted">La montre passe dans ta collection avec ses photos. Tu pourras compléter sa fiche juste après.</p>
    <form id="acquire-form">
      <div class="form-grid">
        ${fieldHtml({ name: "purchase_date", label: "Date d'achat", type: "date" }, today())}
        ${fieldHtml({ name: "purchase_price", label: "Prix payé", type: "number", unit: "€", step: "0.01" }, w.current_price ?? w.target_price)}
        ${fieldHtml({ name: "purchase_place", label: "Lieu d'achat", wide: true })}
        ${fieldHtml({ name: "condition", label: "État", options: CONDITIONS })}
        ${fieldHtml({ name: "box_papers", label: "Boîte & papiers", type: "checkbox" })}
      </div>
      <div class="modal-actions"><div class="btn-row">
        <button type="button" class="btn btn-ghost" data-close>Annuler</button>
        <button type="submit" class="btn btn-primary">Ajouter à la collection</button>
      </div></div>
    </form>`);

  document.getElementById("acquire-form").addEventListener("submit", guard(async (e) => {
    e.preventDefault();
    const id = await Store.acquireWish(w.id, formValues(e.target));
    $modal.close();
    toast("Ajoutée à la collection — complète sa fiche");
    location.hash = `#/montre/${id}/modifier`;
  }));
}

// Donne le fichier à l'utilisateur : feuille de partage sur téléphone
// (« Enregistrer dans Fichiers », Drive…), téléchargement classique sinon.
async function deliverFile(file) {
  const touch = matchMedia("(pointer: coarse)").matches;
  if (touch && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: file.name });
      return true;
    } catch (err) {
      if (err.name === "AbortError") return false; // partage annulé
    }
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(file);
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  return true;
}

async function pageBackup() {
  const token = renderId;
  const [counts, last, persisted, estimate] = await Promise.all([
    Store.counts(),
    Store.getMeta("last_backup"),
    navigator.storage?.persisted?.().catch(() => false) ?? false,
    navigator.storage?.estimate?.().catch(() => null) ?? null,
  ]);
  if (token !== renderId) return;
  const used = estimate?.usage != null ? `${fmtNum(estimate.usage / 1024 / 1024)} Mo` : "—";

  $app.innerHTML = `
    <div class="page-head">
      <div><div class="eyebrow">Données</div><h1>Sauvegarde</h1>
      <p class="lede">Ta collection est enregistrée uniquement sur cet appareil. Une sauvegarde régulière te protège
      d'une perte ou d'un changement de téléphone, et permet de passer la collection sur un autre appareil.</p></div>
    </div>

    <div class="stats">
      <div class="stat"><div class="stat-value">${counts.watches}</div><div class="stat-label">Montre${counts.watches > 1 ? "s" : ""}</div></div>
      <div class="stat"><div class="stat-value">${counts.wishlist}</div><div class="stat-label">Envie${counts.wishlist > 1 ? "s" : ""}</div></div>
      <div class="stat"><div class="stat-value">${counts.photos}</div><div class="stat-label">Photo${counts.photos > 1 ? "s" : ""}</div></div>
      <div class="stat"><div class="stat-value">${used}</div><div class="stat-label">Espace utilisé</div></div>
    </div>

    <section class="panel">
      <h2>Sauvegarder ma collection</h2>
      <p class="muted">Crée un fichier unique avec toutes tes fiches, l'entretien, la wishlist et les photos.
      Sur iPhone, choisis <em>Enregistrer dans Fichiers</em> (iCloud Drive) pour le garder à l'abri.</p>
      <p class="muted">Dernière sauvegarde : <strong style="color:var(--ink)">${last ? `${fmtDate(last)} (${fmtRelative(-daysSince(last))})` : "jamais"}</strong></p>
      <div class="btn-row" id="export-zone"><button class="btn btn-primary" id="export">Préparer la sauvegarde</button></div>
    </section>

    <section class="panel">
      <h2>Restaurer une sauvegarde</h2>
      <p class="muted">Remplace <strong>toute</strong> la collection de cet appareil par le contenu du fichier choisi.</p>
      <label class="btn">Choisir un fichier…<input type="file" id="import" accept=".json,application/json" hidden></label>
    </section>

    <section class="panel">
      <h2>Sur cet appareil</h2>
      <dl class="specs single">
        <div class="spec"><dt>App installée</dt><dd>${isInstalled() ? "Oui" : "Non"}</dd></div>
        <div class="spec"><dt>Stockage protégé</dt><dd>${persisted ? "Oui" : "Non"}</dd></div>
        <div class="spec"><dt>Interventions enregistrées</dt><dd>${counts.services}</dd></div>
      </dl>
      ${isInstalled() ? "" : `<p class="muted">${isIOS
        ? "Sur iPhone : dans Safari, touche <em>Partager</em> puis <em>Sur l'écran d'accueil</em>. L'app s'ouvrira alors en plein écran et marchera hors ligne."
        : "Sur Android (Chrome) : menu <em>⋮</em> puis <em>Installer l'application</em>. Sur ordinateur : l'icône d'installation dans la barre d'adresse."}</p>`}
    </section>`;

  document.getElementById("export").addEventListener("click", guard(async (e) => {
    e.target.disabled = true;
    e.target.textContent = "Préparation…";
    const blob = await Store.exportBackup();
    const file = new File([blob], `ma-collection-${today()}.json`, { type: "application/json" });
    // Le partage doit partir d'un appui direct : on propose donc un second bouton une fois le fichier prêt.
    const zone = document.getElementById("export-zone");
    zone.innerHTML = `<button class="btn btn-primary" id="save-file">Enregistrer le fichier (${fmtNum(blob.size / 1024 / 1024)} Mo)</button>`;
    document.getElementById("save-file").addEventListener("click", guard(async () => {
      if (!(await deliverFile(file))) return;
      await Store.setMeta("last_backup", new Date().toISOString());
      toast("Sauvegarde créée");
      render();
    }));
  }));

  document.getElementById("import").addEventListener("change", guard(async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    if (counts.watches + counts.wishlist > 0 &&
        !confirm("Remplacer toute la collection de cet appareil par cette sauvegarde ?")) return;
    toast("Restauration…");
    const r = await Store.importBackup(file);
    toast(`Restauré : ${r.watches} montre${r.watches > 1 ? "s" : ""}, ${r.wishlist} envie${r.wishlist > 1 ? "s" : ""}, ${r.photos} photo${r.photos > 1 ? "s" : ""}`);
    location.hash = "#/";
  }));
}

// --- Routeur ----------------------------------------------------------------

const routes = [
  [/^#?\/?$/, pageCollection, "collection"],
  [/^#\/montre\/nouvelle$/, () => pageWatchForm(null), "collection"],
  [/^#\/montre\/(\d+)\/modifier$/, (m) => pageWatchForm(m[1]), "collection"],
  [/^#\/montre\/(\d+)$/, (m) => pageWatch(m[1]), "collection"],
  [/^#\/entretien$/, pageMaintenance, "entretien"],
  [/^#\/wishlist$/, pageWishlist, "wishlist"],
  [/^#\/sauvegarde$/, pageBackup, "sauvegarde"],
];

// Chaque affichage reçoit un numéro : une page dont les données arrivent après
// une navigation plus récente ne doit pas écraser la nouvelle page.
let renderId = 0;

async function render() {
  const id = ++renderId;
  const hash = location.hash || "#/";
  const [re, page, nav] = routes.find(([r]) => r.test(hash)) || routes[0];
  document.querySelectorAll("[data-nav]").forEach((a) => a.classList.toggle("active", a.dataset.nav === nav));
  try {
    await page(hash.match(re));
  } catch (err) {
    if (id !== renderId) return;
    $app.innerHTML = `<div class="empty"><h2>Oups</h2><p>${esc(err.message)}</p>
      <div class="btn-row" style="justify-content:center;margin-top:18px">
        <button class="btn" id="retry">Réessayer</button>
        <a class="btn btn-ghost" href="#/">Retour à la collection</a>
      </div></div>`;
    document.getElementById("retry").addEventListener("click", render);
  }
}

window.addEventListener("hashchange", () => {
  if ($modal.open) $modal.close();
  window.scrollTo(0, 0);
  render();
});
render();

// Demande au navigateur de ne pas effacer les données en cas de manque de place.
navigator.storage?.persist?.().catch(() => {});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
