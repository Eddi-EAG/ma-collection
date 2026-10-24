"""Collection de montres : serveur local (API JSON + interface web).

L'interface (static/) ne parle au serveur que via /api, donc le jour où
l'app est hébergée il suffit de déployer ce serveur tel quel, en changeant
éventuellement DATA_DIR (base SQLite + photos).
"""

import os
import sqlite3
import sys
import threading
import uuid
import webbrowser
from datetime import date, datetime, timedelta
from pathlib import Path

from flask import Flask, abort, g, jsonify, request, send_from_directory

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = Path(os.environ.get("DATA_DIR", BASE_DIR / "data"))
UPLOAD_DIR = DATA_DIR / "uploads"
DB_PATH = DATA_DIR / "montres.db"

# Formats affichables par les navigateurs (le HEIC des iPhone ne l'est pas).
ALLOWED_IMAGE_EXT = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif"}
SOON_DAYS = 180  # une révision est "à prévoir" dans les 6 mois avant l'échéance
FULL_SERVICE = "Révision complète"

# Champs éditables de chaque table, avec leur type.
WATCH_FIELDS = {
    "brand": str, "model": str, "reference": str, "serial_number": str,
    "year": int, "movement_type": str, "caliber": str,
    "power_reserve_h": float, "frequency_bph": int, "jewels": int,
    "complications": str, "case_diameter_mm": float, "case_thickness_mm": float,
    "lug_width_mm": float, "lug_to_lug_mm": float, "case_material": str,
    "crystal": str, "water_resistance_m": int, "dial_color": str, "bezel": str,
    "strap": str, "purchase_date": str, "purchase_price": float,
    "purchase_place": str, "condition": str, "box_papers": int,
    "estimated_value": float, "service_interval_years": float, "notes": str,
}
SERVICE_FIELDS = {"date": str, "type": str, "provider": str, "cost": float, "notes": str}
WISH_FIELDS = {
    "brand": str, "model": str, "reference": str, "target_price": float,
    "current_price": float, "priority": int, "link": str, "notes": str,
}

SCHEMA = f"""
CREATE TABLE IF NOT EXISTS watches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    {", ".join(f"{name} {'TEXT' if t is str else 'REAL' if t is float else 'INTEGER'}" for name, t in WATCH_FIELDS.items())},
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS photos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    watch_id INTEGER REFERENCES watches(id) ON DELETE CASCADE,
    wish_id INTEGER REFERENCES wishlist(id) ON DELETE CASCADE,
    filename TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS services (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    watch_id INTEGER NOT NULL REFERENCES watches(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    type TEXT NOT NULL,
    provider TEXT,
    cost REAL,
    notes TEXT,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS wishlist (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    brand TEXT, model TEXT, reference TEXT,
    target_price REAL, current_price REAL,
    priority INTEGER DEFAULT 2,
    link TEXT, notes TEXT,
    created_at TEXT NOT NULL
);
"""

app = Flask(__name__, static_folder="static", static_url_path="")
app.config["MAX_CONTENT_LENGTH"] = 40 * 1024 * 1024  # 40 Mo par envoi


# --- Base de données -------------------------------------------------------

def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(DB_PATH)
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA foreign_keys = ON")
    return g.db


@app.teardown_appcontext
def close_db(_exc):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db():
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(DB_PATH) as db:
        db.executescript(SCHEMA)


def now():
    return datetime.now().isoformat(timespec="seconds")


def clean(payload, fields):
    """Garde les champs connus et convertit les valeurs ("" -> NULL)."""
    out = {}
    for name, kind in fields.items():
        if name not in payload:
            continue
        value = payload[name]
        if value is None or (isinstance(value, str) and value.strip() == ""):
            out[name] = None
            continue
        try:
            value = value.strip() if isinstance(value, str) else value
            # "24.0" doit donner 24 pour un champ entier, pas une erreur
            out[name] = int(float(value)) if kind is int else kind(value)
        except (TypeError, ValueError):
            abort(400, f"Valeur invalide pour « {name} »")
    return out


def insert(table, data):
    data = {**data, "created_at": now()}
    if table == "watches":
        data["updated_at"] = data["created_at"]
    cols = ", ".join(data)
    marks = ", ".join("?" for _ in data)
    cur = get_db().execute(f"INSERT INTO {table} ({cols}) VALUES ({marks})", list(data.values()))
    get_db().commit()
    return cur.lastrowid


def update(table, row_id, data):
    if table == "watches":
        data = {**data, "updated_at": now()}
    if not data:
        return
    sets = ", ".join(f"{col} = ?" for col in data)
    get_db().execute(f"UPDATE {table} SET {sets} WHERE id = ?", [*data.values(), row_id])
    get_db().commit()


def fetch_one(sql, args=()):
    row = get_db().execute(sql, args).fetchone()
    if row is None:
        abort(404, "Élément introuvable : il a peut-être été supprimé")
    return dict(row)


def photos_for(column, row_id):
    rows = get_db().execute(
        f"SELECT id, filename FROM photos WHERE {column} = ? ORDER BY id", (row_id,)
    ).fetchall()
    return [{"id": r["id"], "url": f"/uploads/{r['filename']}"} for r in rows]


def delete_photo_files(column, row_id):
    for r in get_db().execute(f"SELECT filename FROM photos WHERE {column} = ?", (row_id,)):
        (UPLOAD_DIR / r["filename"]).unlink(missing_ok=True)


def save_uploads(column, row_id):
    """Enregistre les photos envoyées ; renvoie les ids créés et les noms des
    fichiers refusés (format non affichable) pour que l'interface le signale."""
    saved, skipped = [], []
    for file in request.files.getlist("photos"):
        ext = Path(file.filename or "").suffix.lower()
        if ext not in ALLOWED_IMAGE_EXT:
            skipped.append(file.filename)
            continue
        filename = f"{uuid.uuid4().hex}{ext}"
        file.save(UPLOAD_DIR / filename)
        saved.append(insert("photos", {column: row_id, "filename": filename}))
    return {"ids": saved, "skipped": skipped}


# --- Entretien ---------------------------------------------------------------

def add_years(d, years):
    return d + timedelta(days=round(years * 365.25))


def maintenance_status(watch, services):
    """Calcule la prochaine révision à partir de la dernière révision complète
    (ou, à défaut, de la date d'achat) et de l'intervalle propre à la montre."""
    interval = watch.get("service_interval_years") or 5
    full = [s["date"] for s in services if s["type"] == FULL_SERVICE and s["date"]]
    base, base_label = None, None
    if full:
        base, base_label = max(full), "dernière révision"
    elif watch.get("purchase_date"):
        base, base_label = watch["purchase_date"], "achat"

    if not base:
        return {"status": "unknown", "next_due": None, "base": None, "base_label": None,
                "days_left": None, "interval_years": interval}
    try:
        next_due = add_years(date.fromisoformat(base[:10]), interval)
    except ValueError:
        return {"status": "unknown", "next_due": None, "base": base, "base_label": base_label,
                "days_left": None, "interval_years": interval}
    days_left = (next_due - date.today()).days
    status = "overdue" if days_left < 0 else "soon" if days_left <= SOON_DAYS else "ok"
    return {"status": status, "next_due": next_due.isoformat(), "base": base,
            "base_label": base_label, "days_left": days_left, "interval_years": interval}


def services_for(watch_id):
    rows = get_db().execute(
        "SELECT * FROM services WHERE watch_id = ? ORDER BY date DESC, id DESC", (watch_id,)
    ).fetchall()
    return [dict(r) for r in rows]


def watch_summary(watch):
    services = services_for(watch["id"])
    photos = photos_for("watch_id", watch["id"])
    return {
        **watch,
        "cover": photos[0]["url"] if photos else None,
        "maintenance": maintenance_status(watch, services),
        "service_total": sum(s["cost"] or 0 for s in services),
    }


# --- API : montres -----------------------------------------------------------

@app.get("/api/watches")
def list_watches():
    rows = get_db().execute("SELECT * FROM watches ORDER BY brand COLLATE NOCASE, model COLLATE NOCASE").fetchall()
    return jsonify([watch_summary(dict(r)) for r in rows])


@app.post("/api/watches")
def create_watch():
    data = clean(request.get_json(force=True), WATCH_FIELDS)
    if not data.get("brand") and not data.get("model"):
        abort(400, "Indique au moins la marque ou le modèle")
    return jsonify({"id": insert("watches", data)}), 201


@app.get("/api/watches/<int:watch_id>")
def get_watch(watch_id):
    watch = fetch_one("SELECT * FROM watches WHERE id = ?", (watch_id,))
    services = services_for(watch_id)
    return jsonify({
        **watch_summary(watch),
        "photos": photos_for("watch_id", watch_id),
        "services": services,
    })


@app.put("/api/watches/<int:watch_id>")
def update_watch(watch_id):
    fetch_one("SELECT id FROM watches WHERE id = ?", (watch_id,))
    update("watches", watch_id, clean(request.get_json(force=True), WATCH_FIELDS))
    return jsonify({"ok": True})


@app.delete("/api/watches/<int:watch_id>")
def delete_watch(watch_id):
    fetch_one("SELECT id FROM watches WHERE id = ?", (watch_id,))
    delete_photo_files("watch_id", watch_id)
    get_db().execute("DELETE FROM watches WHERE id = ?", (watch_id,))
    get_db().commit()
    return jsonify({"ok": True})


@app.post("/api/watches/<int:watch_id>/photos")
def upload_watch_photos(watch_id):
    fetch_one("SELECT id FROM watches WHERE id = ?", (watch_id,))
    return jsonify(save_uploads("watch_id", watch_id)), 201


@app.delete("/api/photos/<int:photo_id>")
def delete_photo(photo_id):
    photo = fetch_one("SELECT * FROM photos WHERE id = ?", (photo_id,))
    (UPLOAD_DIR / photo["filename"]).unlink(missing_ok=True)
    get_db().execute("DELETE FROM photos WHERE id = ?", (photo_id,))
    get_db().commit()
    return jsonify({"ok": True})


# --- API : entretien ---------------------------------------------------------

@app.post("/api/watches/<int:watch_id>/services")
def create_service(watch_id):
    fetch_one("SELECT id FROM watches WHERE id = ?", (watch_id,))
    data = clean(request.get_json(force=True), SERVICE_FIELDS)
    if not data.get("date") or not data.get("type"):
        abort(400, "La date et le type d'intervention sont obligatoires")
    return jsonify({"id": insert("services", {**data, "watch_id": watch_id})}), 201


@app.put("/api/services/<int:service_id>")
def update_service(service_id):
    fetch_one("SELECT id FROM services WHERE id = ?", (service_id,))
    update("services", service_id, clean(request.get_json(force=True), SERVICE_FIELDS))
    return jsonify({"ok": True})


@app.delete("/api/services/<int:service_id>")
def delete_service(service_id):
    fetch_one("SELECT id FROM services WHERE id = ?", (service_id,))
    get_db().execute("DELETE FROM services WHERE id = ?", (service_id,))
    get_db().commit()
    return jsonify({"ok": True})


@app.get("/api/maintenance")
def maintenance_overview():
    rows = get_db().execute("SELECT * FROM watches").fetchall()
    items = []
    for row in rows:
        summary = watch_summary(dict(row))
        last = services_for(row["id"])
        summary["last_service"] = last[0] if last else None
        items.append(summary)
    order = {"overdue": 0, "soon": 1, "ok": 2, "unknown": 3}
    items.sort(key=lambda w: (order[w["maintenance"]["status"]], w["maintenance"]["next_due"] or "9999"))
    return jsonify(items)


# --- API : wishlist ----------------------------------------------------------

def wish_with_photos(wish):
    photos = photos_for("wish_id", wish["id"])
    return {**wish, "photos": photos, "cover": photos[0]["url"] if photos else None}


@app.get("/api/wishlist")
def list_wishlist():
    rows = get_db().execute("SELECT * FROM wishlist ORDER BY priority, created_at DESC").fetchall()
    return jsonify([wish_with_photos(dict(r)) for r in rows])


@app.post("/api/wishlist")
def create_wish():
    data = clean(request.get_json(force=True), WISH_FIELDS)
    if not data.get("brand") and not data.get("model"):
        abort(400, "Indique au moins la marque ou le modèle")
    return jsonify({"id": insert("wishlist", data)}), 201


@app.put("/api/wishlist/<int:wish_id>")
def update_wish(wish_id):
    fetch_one("SELECT id FROM wishlist WHERE id = ?", (wish_id,))
    update("wishlist", wish_id, clean(request.get_json(force=True), WISH_FIELDS))
    return jsonify({"ok": True})


@app.delete("/api/wishlist/<int:wish_id>")
def delete_wish(wish_id):
    fetch_one("SELECT id FROM wishlist WHERE id = ?", (wish_id,))
    delete_photo_files("wish_id", wish_id)
    get_db().execute("DELETE FROM wishlist WHERE id = ?", (wish_id,))
    get_db().commit()
    return jsonify({"ok": True})


@app.post("/api/wishlist/<int:wish_id>/photos")
def upload_wish_photos(wish_id):
    fetch_one("SELECT id FROM wishlist WHERE id = ?", (wish_id,))
    return jsonify(save_uploads("wish_id", wish_id)), 201


@app.post("/api/wishlist/<int:wish_id>/acquire")
def acquire_wish(wish_id):
    """La montre convoitée est achetée : elle passe dans la collection
    (avec ses photos) et quitte la wishlist."""
    wish = fetch_one("SELECT * FROM wishlist WHERE id = ?", (wish_id,))
    extra = clean(request.get_json(silent=True) or {}, WATCH_FIELDS)
    watch_id = insert("watches", {
        "brand": wish["brand"], "model": wish["model"], "reference": wish["reference"],
        "notes": wish["notes"], "purchase_date": date.today().isoformat(), **extra,
    })
    db = get_db()
    db.execute("UPDATE photos SET watch_id = ?, wish_id = NULL WHERE wish_id = ?", (watch_id, wish_id))
    db.execute("DELETE FROM wishlist WHERE id = ?", (wish_id,))
    db.commit()
    return jsonify({"id": watch_id}), 201


# --- Fichiers ----------------------------------------------------------------

@app.get("/uploads/<path:filename>")
def uploaded_file(filename):
    return send_from_directory(UPLOAD_DIR, filename)


@app.get("/")
def index():
    return app.send_static_file("index.html")


@app.errorhandler(400)
@app.errorhandler(404)
@app.errorhandler(413)
def json_error(err):
    if request.path.startswith("/api/"):
        message = "Photo trop lourde (40 Mo maximum)" if err.code == 413 else err.description
        return jsonify({"error": message}), err.code
    return err


init_db()

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    url = f"http://localhost:{port}"
    print(f"Collection de montres : {url}")
    if "--open" in sys.argv:
        # Ouvre le navigateur une fois le serveur démarré, pas avant.
        threading.Timer(1.0, webbrowser.open, args=(url,)).start()
    app.run(host=os.environ.get("HOST", "127.0.0.1"), port=port, debug=False)
