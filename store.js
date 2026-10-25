// Stockage local de la collection, directement sur l'appareil (IndexedDB).
// Rien ne part sur internet : fiches, entretien, wishlist et photos restent
// dans le navigateur ou l'app installée. Les sauvegardes passent par un fichier.

const DB_NAME = "ma-collection";
const DB_VERSION = 1;
const BACKUP_APP = "ma-collection";
const BACKUP_FORMAT = 1;

const SOON_DAYS = 180; // une révision est "à prévoir" dans les 6 mois avant l'échéance
const FULL_SERVICE = "Révision complète";
const PHOTO_MAX = 1600; // px, côté le plus long
const THUMB_MAX = 480;

// Champs éditables, avec leur type : text, num ou int.
const WATCH_FIELDS = {
  brand: "text", model: "text", reference: "text", serial_number: "text",
  year: "int", movement_type: "text", caliber: "text",
  power_reserve_h: "num", frequency_bph: "int", jewels: "int",
  complications: "text", case_diameter_mm: "num", case_thickness_mm: "num",
  lug_width_mm: "num", lug_to_lug_mm: "num", case_material: "text",
  crystal: "text", water_resistance_m: "int", dial_color: "text", bezel: "text",
  strap: "text", purchase_date: "text", purchase_price: "num",
  purchase_place: "text", condition: "text", box_papers: "int",
  estimated_value: "num", service_interval_years: "num", notes: "text",
};
const SERVICE_FIELDS = { date: "text", type: "text", provider: "text", cost: "num", notes: "text" };
const WISH_FIELDS = {
  brand: "text", model: "text", reference: "text", target_price: "num",
  current_price: "num", priority: "int", link: "text", notes: "text",
};

// --- IndexedDB ---------------------------------------------------------------

let dbPromise;

function openDb() {
  dbPromise ??= new Promise((resolve, reject) => {
    if (!window.indexedDB) {
      reject(new Error("Le stockage local n'est pas disponible sur ce navigateur."));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore("watches", { keyPath: "id", autoIncrement: true });
      db.createObjectStore("services", { keyPath: "id", autoIncrement: true }).createIndex("watch_id", "watch_id");
      db.createObjectStore("wishlist", { keyPath: "id", autoIncrement: true });
      const photos = db.createObjectStore("photos", { keyPath: "id", autoIncrement: true });
      photos.createIndex("watch_id", "watch_id");
      photos.createIndex("wish_id", "wish_id");
      db.createObjectStore("meta", { keyPath: "key" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      dbPromise = null;
      reject(new Error("Impossible d'ouvrir le stockage local (navigation privée ?)."));
    };
  });
  return dbPromise;
}

const req = (r) => new Promise((resolve, reject) => {
  r.onsuccess = () => resolve(r.result);
  r.onerror = () => reject(r.error);
});

// Exécute fn dans une transaction et résout quand tout est écrit.
// fn ne doit attendre que des requêtes IndexedDB (sinon la transaction se ferme).
async function run(storeNames, mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(storeNames, mode);
    let result;
    Promise.resolve(fn(t)).then((r) => { result = r; }, (err) => {
      try { t.abort(); } catch { /* déjà terminée */ }
      reject(err);
    });
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error("Opération annulée"));
  });
}

const now = () => new Date().toISOString().slice(0, 19);

export function localIsoDate(d = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Garde les champs connus et convertit les valeurs ("" -> null).
function clean(payload, fields) {
  const out = {};
  for (const [name, kind] of Object.entries(fields)) {
    if (!(name in payload)) continue;
    const value = payload[name];
    if (value == null || (typeof value === "string" && value.trim() === "")) {
      out[name] = null;
      continue;
    }
    if (kind === "text") {
      out[name] = String(value).trim();
      continue;
    }
    const n = Number(String(value).trim().replace(",", "."));
    if (!Number.isFinite(n)) throw new Error(`Valeur invalide pour « ${name} »`);
    out[name] = kind === "int" ? Math.trunc(n) : n;
  }
  return out;
}

const requireName = (d) => {
  if (!d.brand && !d.model) throw new Error("Indique au moins la marque ou le modèle");
};

// --- Photos ------------------------------------------------------------------

function loadImage(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Format d'image non lisible")); };
    img.src = url;
  });
}

// Réduit l'image (les photos de téléphone font souvent 5 à 10 Mo) et la convertit en JPEG.
function toJpeg(img, max, quality) {
  const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff"; // fond blanc pour les PNG transparents
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Conversion impossible"))), "image/jpeg", quality));
}

async function preparePhoto(blob) {
  const img = await loadImage(blob);
  return { blob: await toJpeg(img, PHOTO_MAX, 0.85), thumb: await toJpeg(img, THUMB_MAX, 0.8) };
}

// Une URL d'affichage par photo, créée à la demande et gardée pendant la session.
const urlCache = new Map();

function photoUrl(photo, kind) {
  const key = `${photo.id}:${kind}`;
  if (!urlCache.has(key)) urlCache.set(key, URL.createObjectURL(kind === "thumb" ? photo.thumb : photo.blob));
  return urlCache.get(key);
}

function forgetPhotoUrls(id) {
  for (const kind of ["thumb", "full"]) {
    const key = `${id}:${kind}`;
    if (urlCache.has(key)) URL.revokeObjectURL(urlCache.get(key));
    urlCache.delete(key);
  }
}

const photoView = (p) => ({ id: p.id, url: photoUrl(p, "full"), thumb: photoUrl(p, "thumb") });

async function photosOf(t, index, id) {
  const rows = await req(t.objectStore("photos").index(index).getAll(Number(id)));
  return rows.sort((a, b) => a.id - b.id);
}

async function deletePhotosOf(t, index, id) {
  const store = t.objectStore("photos");
  const keys = await req(store.index(index).getAllKeys(Number(id)));
  for (const key of keys) {
    forgetPhotoUrls(key);
    await req(store.delete(key));
  }
}

// --- Entretien -----------------------------------------------------------------

// Prochaine révision = dernière révision complète (ou, à défaut, achat) + intervalle de la montre.
function maintenanceStatus(watch, services) {
  const interval = watch.service_interval_years || 5;
  const full = services.filter((s) => s.type === FULL_SERVICE && s.date).map((s) => s.date).sort();
  let base = null;
  let baseLabel = null;
  if (full.length) [base, baseLabel] = [full[full.length - 1], "dernière révision"];
  else if (watch.purchase_date) [base, baseLabel] = [watch.purchase_date, "achat"];

  const unknown = { status: "unknown", next_due: null, base, base_label: baseLabel, days_left: null, interval_years: interval };
  if (!base) return unknown;
  const start = new Date(`${base.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(start.getTime())) return unknown;

  const due = new Date(start);
  due.setDate(due.getDate() + Math.round(interval * 365.25));
  const today = new Date(`${localIsoDate()}T12:00:00`);
  const daysLeft = Math.round((due - today) / 86400000);
  const status = daysLeft < 0 ? "overdue" : daysLeft <= SOON_DAYS ? "soon" : "ok";
  return { status, next_due: localIsoDate(due), base, base_label: baseLabel, days_left: daysLeft, interval_years: interval };
}

const byDateDesc = (a, b) => (b.date || "").localeCompare(a.date || "") || b.id - a.id;

async function watchSummary(t, watch) {
  const services = (await req(t.objectStore("services").index("watch_id").getAll(watch.id))).sort(byDateDesc);
  const photos = await photosOf(t, "watch_id", watch.id);
  return {
    ...watch,
    cover: photos[0] ? photoUrl(photos[0], "thumb") : null,
    maintenance: maintenanceStatus(watch, services),
    service_total: services.reduce((s, x) => s + (x.cost || 0), 0),
    services,
    photos: photos.map(photoView),
  };
}

const watchName = (w) => [w.brand, w.model].filter(Boolean).join(" ");

// --- API ---------------------------------------------------------------------

export const Store = {
  // Montres

  listWatches() {
    return run(["watches", "services", "photos"], "readonly", async (t) => {
      const watches = await req(t.objectStore("watches").getAll());
      const out = [];
      for (const w of watches) out.push(await watchSummary(t, w));
      return out.sort((a, b) => watchName(a).localeCompare(watchName(b), "fr"));
    });
  },

  getWatch(id) {
    return run(["watches", "services", "photos"], "readonly", async (t) => {
      const watch = await req(t.objectStore("watches").get(Number(id)));
      if (!watch) throw new Error("Montre introuvable : elle a peut-être été supprimée");
      return watchSummary(t, watch);
    });
  },

  async createWatch(payload) {
    const data = clean(payload, WATCH_FIELDS);
    requireName(data);
    const stamp = now();
    return run(["watches"], "readwrite", (t) =>
      req(t.objectStore("watches").add({ ...data, created_at: stamp, updated_at: stamp })));
  },

  async updateWatch(id, payload) {
    const data = clean(payload, WATCH_FIELDS);
    return run(["watches"], "readwrite", async (t) => {
      const store = t.objectStore("watches");
      const watch = await req(store.get(Number(id)));
      if (!watch) throw new Error("Montre introuvable");
      const merged = { ...watch, ...data, updated_at: now() };
      requireName(merged);
      await req(store.put(merged));
    });
  },

  deleteWatch(id) {
    return run(["watches", "services", "photos"], "readwrite", async (t) => {
      const services = t.objectStore("services");
      for (const key of await req(services.index("watch_id").getAllKeys(Number(id)))) await req(services.delete(key));
      await deletePhotosOf(t, "watch_id", id);
      await req(t.objectStore("watches").delete(Number(id)));
    });
  },

  // Photos : owner vaut { watch_id } ou { wish_id }. Renvoie les fichiers refusés.
  async addPhotos(owner, files) {
    const prepared = [];
    const skipped = [];
    for (const file of files || []) {
      try {
        prepared.push(await preparePhoto(file));
      } catch {
        skipped.push(file.name);
      }
    }
    const link = { watch_id: owner.watch_id ? Number(owner.watch_id) : null, wish_id: owner.wish_id ? Number(owner.wish_id) : null };
    if (prepared.length) {
      await run(["photos"], "readwrite", async (t) => {
        for (const p of prepared) await req(t.objectStore("photos").add({ ...link, ...p, created_at: now() }));
      });
    }
    return skipped;
  },

  deletePhoto(id) {
    forgetPhotoUrls(Number(id));
    return run(["photos"], "readwrite", (t) => req(t.objectStore("photos").delete(Number(id))));
  },

  // Entretien

  async createService(watchId, payload) {
    const data = clean(payload, SERVICE_FIELDS);
    if (!data.date || !data.type) throw new Error("La date et le type d'intervention sont obligatoires");
    return run(["services"], "readwrite", (t) =>
      req(t.objectStore("services").add({ ...data, watch_id: Number(watchId), created_at: now() })));
  },

  deleteService(id) {
    return run(["services"], "readwrite", (t) => req(t.objectStore("services").delete(Number(id))));
  },

  async maintenanceOverview() {
    const items = (await Store.listWatches()).map((w) => ({ ...w, last_service: w.services[0] || null }));
    const order = { overdue: 0, soon: 1, ok: 2, unknown: 3 };
    return items.sort((a, b) => order[a.maintenance.status] - order[b.maintenance.status]
      || (a.maintenance.next_due || "9999").localeCompare(b.maintenance.next_due || "9999"));
  },

  // Wishlist

  listWishlist() {
    return run(["wishlist", "photos"], "readonly", async (t) => {
      const wishes = await req(t.objectStore("wishlist").getAll());
      const out = [];
      for (const w of wishes) {
        const photos = (await photosOf(t, "wish_id", w.id)).map(photoView);
        out.push({ ...w, photos, cover: photos[0]?.thumb || null });
      }
      return out.sort((a, b) => (a.priority ?? 2) - (b.priority ?? 2) || (b.created_at || "").localeCompare(a.created_at || ""));
    });
  },

  async createWish(payload) {
    const data = clean(payload, WISH_FIELDS);
    requireName(data);
    return run(["wishlist"], "readwrite", (t) => req(t.objectStore("wishlist").add({ priority: 2, ...data, created_at: now() })));
  },

  async updateWish(id, payload) {
    const data = clean(payload, WISH_FIELDS);
    return run(["wishlist"], "readwrite", async (t) => {
      const store = t.objectStore("wishlist");
      const wish = await req(store.get(Number(id)));
      if (!wish) throw new Error("Envie introuvable");
      const merged = { ...wish, ...data };
      requireName(merged);
      await req(store.put(merged));
    });
  },

  deleteWish(id) {
    return run(["wishlist", "photos"], "readwrite", async (t) => {
      await deletePhotosOf(t, "wish_id", id);
      await req(t.objectStore("wishlist").delete(Number(id)));
    });
  },

  // La montre convoitée est achetée : elle passe dans la collection avec ses photos.
  async acquireWish(id, payload) {
    const extra = clean(payload || {}, WATCH_FIELDS);
    return run(["wishlist", "watches", "photos"], "readwrite", async (t) => {
      const wish = await req(t.objectStore("wishlist").get(Number(id)));
      if (!wish) throw new Error("Envie introuvable");
      const stamp = now();
      const watchId = await req(t.objectStore("watches").add({
        brand: wish.brand, model: wish.model, reference: wish.reference, notes: wish.notes,
        purchase_date: localIsoDate(), ...extra, created_at: stamp, updated_at: stamp,
      }));
      const photos = t.objectStore("photos");
      for (const p of await req(photos.index("wish_id").getAll(Number(id)))) {
        await req(photos.put({ ...p, wish_id: null, watch_id: watchId }));
      }
      await req(t.objectStore("wishlist").delete(Number(id)));
      return watchId;
    });
  },

  // Réglages et sauvegarde

  getMeta(key) {
    return run(["meta"], "readonly", async (t) => (await req(t.objectStore("meta").get(key)))?.value ?? null);
  },

  setMeta(key, value) {
    return run(["meta"], "readwrite", (t) => req(t.objectStore("meta").put({ key, value })));
  },

  counts() {
    return run(["watches", "wishlist", "photos", "services"], "readonly", async (t) => ({
      watches: await req(t.objectStore("watches").count()),
      wishlist: await req(t.objectStore("wishlist").count()),
      photos: await req(t.objectStore("photos").count()),
      services: await req(t.objectStore("services").count()),
    }));
  },

  // Fichier de sauvegarde unique (JSON, photos incluses).
  async exportBackup() {
    const data = await run(["watches", "services", "wishlist", "photos"], "readonly", async (t) => ({
      watches: await req(t.objectStore("watches").getAll()),
      services: await req(t.objectStore("services").getAll()),
      wishlist: await req(t.objectStore("wishlist").getAll()),
      photos: await req(t.objectStore("photos").getAll()),
    }));
    const photos = [];
    for (const p of data.photos) {
      photos.push({ id: p.id, watch_id: p.watch_id, wish_id: p.wish_id, created_at: p.created_at, data: await blobToDataUrl(p.blob) });
    }
    const backup = { app: BACKUP_APP, format: BACKUP_FORMAT, exported_at: now(), ...data, photos };
    return new Blob([JSON.stringify(backup)], { type: "application/json" });
  },

  // Remplace toute la collection de l'appareil par le contenu de la sauvegarde.
  async importBackup(file) {
    let backup;
    try {
      backup = JSON.parse(await file.text());
    } catch {
      throw new Error("Ce fichier n'est pas une sauvegarde valide");
    }
    if (backup?.app !== BACKUP_APP || !Array.isArray(backup.watches)) {
      throw new Error("Ce fichier n'est pas une sauvegarde de Ma Collection");
    }
    if (backup.format > BACKUP_FORMAT) throw new Error("Sauvegarde créée par une version plus récente de l'app");

    // Les photos sont préparées avant la transaction (qui ne peut rien attendre d'autre qu'IndexedDB).
    const photos = [];
    for (const p of backup.photos || []) {
      const blob = await (await fetch(p.data)).blob();
      let thumb = blob;
      try { thumb = await toJpeg(await loadImage(blob), THUMB_MAX, 0.8); } catch { /* on garde l'image d'origine */ }
      photos.push({ id: p.id, watch_id: p.watch_id ?? null, wish_id: p.wish_id ?? null, created_at: p.created_at, blob, thumb });
    }

    await run(["watches", "services", "wishlist", "photos"], "readwrite", async (t) => {
      for (const name of ["watches", "services", "wishlist", "photos"]) await req(t.objectStore(name).clear());
      for (const w of backup.watches) await req(t.objectStore("watches").put(w));
      for (const s of backup.services || []) await req(t.objectStore("services").put(s));
      for (const w of backup.wishlist || []) await req(t.objectStore("wishlist").put(w));
      for (const p of photos) await req(t.objectStore("photos").put(p));
    });
    for (const url of urlCache.values()) URL.revokeObjectURL(url);
    urlCache.clear();
    return { watches: backup.watches.length, wishlist: (backup.wishlist || []).length, photos: photos.length };
  },
};

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
