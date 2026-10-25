"""Génère les icônes de l'app (écran d'accueil iPhone/Android, onglet du navigateur).

Usage : python outils/generer_icones.py   (nécessite Pillow : pip install pillow)
"""

from pathlib import Path

from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "icons"
INK = (29, 27, 24)
BRASS = (200, 165, 106)
SIZE = 1024  # dessin en grand puis réduction, pour des bords lisses


def draw_icon(dial_ratio):
    """Cadran laiton sur fond encre ; dial_ratio = diamètre du cadran / côté."""
    img = Image.new("RGB", (SIZE, SIZE), INK)
    d = ImageDraw.Draw(img)
    c = SIZE / 2
    r = SIZE * dial_ratio / 2
    stroke = round(SIZE * 0.028)

    d.ellipse([c - r, c - r, c + r, c + r], outline=BRASS, width=stroke)
    # Index des heures : traits à 12, 3, 6 et 9 h
    for dx, dy in [(0, -1), (1, 0), (0, 1), (-1, 0)]:
        x1, y1 = c + dx * r * 0.80, c + dy * r * 0.80
        x2, y2 = c + dx * r * 0.66, c + dy * r * 0.66
        d.line([x1, y1, x2, y2], fill=BRASS, width=round(stroke * 0.8))
    # Aiguilles : 10 h 10, la pose classique des catalogues horlogers
    d.line([c, c, c - r * 0.42, c - r * 0.24], fill=BRASS, width=stroke)
    d.line([c, c, c + r * 0.50, c - r * 0.34], fill=BRASS, width=round(stroke * 0.75))
    cap = stroke * 0.9
    d.ellipse([c - cap, c - cap, c + cap, c + cap], fill=BRASS)
    return img


def main():
    OUT.mkdir(exist_ok=True)
    standard = draw_icon(0.62)
    maskable = draw_icon(0.50)  # marge plus grande : Android peut rogner en cercle
    for name, img, px in [
        ("icon-192.png", standard, 192),
        ("icon-512.png", standard, 512),
        ("apple-touch-icon.png", standard, 180),
        ("icon-maskable-512.png", maskable, 512),
    ]:
        img.resize((px, px), Image.LANCZOS).save(OUT / name, optimize=True)
        print("écrit", OUT / name)


if __name__ == "__main__":
    main()
