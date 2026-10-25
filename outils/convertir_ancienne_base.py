"""Convertit les données de l'ancienne version PC (data/montres.db + data/uploads)
en fichier de sauvegarde à restaurer dans l'app (page Sauvegarde > Restaurer).

Usage : python outils/convertir_ancienne_base.py
Écrit : data/sauvegarde-depuis-pc.json
"""

import base64
import json
import mimetypes
import sqlite3
from datetime import datetime
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "data"


def main():
    db = sqlite3.connect(DATA / "montres.db")
    db.row_factory = sqlite3.Row
    rows = lambda table: [dict(r) for r in db.execute(f"SELECT * FROM {table} ORDER BY id")]

    photos = []
    for p in rows("photos"):
        path = DATA / "uploads" / p["filename"]
        if not path.exists():
            print("photo manquante, ignorée :", path.name)
            continue
        mime = mimetypes.guess_type(path.name)[0] or "image/jpeg"
        photos.append({
            "id": p["id"], "watch_id": p["watch_id"], "wish_id": p["wish_id"], "created_at": p["created_at"],
            "data": f"data:{mime};base64,{base64.b64encode(path.read_bytes()).decode()}",
        })

    backup = {
        "app": "ma-collection",
        "format": 1,
        "exported_at": datetime.now().isoformat(timespec="seconds"),
        "watches": rows("watches"),
        "services": rows("services"),
        "wishlist": rows("wishlist"),
        "photos": photos,
    }
    out = DATA / "sauvegarde-depuis-pc.json"
    out.write_text(json.dumps(backup, ensure_ascii=False), encoding="utf-8")
    print(f"{len(backup['watches'])} montre(s), {len(backup['wishlist'])} envie(s), {len(photos)} photo(s) -> {out}")


if __name__ == "__main__":
    main()
