# Ma Collection — registre horloger

Application locale pour suivre une collection de montres : fiches détaillées,
photos, suivi d'entretien et wishlist.

## Lancer

Double-clic sur **`Lancer la collection.bat`** : le navigateur s'ouvre sur
http://localhost:5000. Laisse la fenêtre noire ouverte tant que tu utilises l'app
(la fermer arrête l'app).

Ou en ligne de commande :

```bash
pip install -r requirements.txt
python app.py
```

## Fonctionnalités

- **Collection** : fiche complète (identité, mouvement, boîtier, achat et valeur),
  plusieurs photos par montre, recherche, filtre par type de mouvement, tris, stats.
- **Entretien** : historique des interventions (révision, pile, étanchéité…),
  avec les coûts. La prochaine révision est calculée à partir de la dernière
  révision complète (ou de la date d'achat) et de l'intervalle choisi pour chaque
  montre (5 ans par défaut). Les montres en retard ou à prévoir dans les 6 mois sont signalées.
- **Wishlist** : prix cible, prix constaté (avec l'indication « dans le budget »),
  priorité, lien et photos. Le bouton « Je l'ai achetée » fait passer la montre
  dans la collection avec ses photos.

## Données

Tout est stocké dans le dossier `data/` :

- `data/montres.db` : la base SQLite
- `data/uploads/` : les photos

**Pour sauvegarder ta collection, copie le dossier `data/`.**

## Architecture (pour l'hébergement futur)

- `app.py` : serveur Flask avec une API JSON (`/api/watches`, `/api/wishlist`,
  `/api/maintenance`…) et le service des photos.
- `static/` : l'interface (HTML/CSS/JS, sans étape de build). Elle ne parle au
  serveur que par l'API.

Réglages par variables d'environnement : `DATA_DIR` (emplacement des données),
`HOST` et `PORT`. Pour héberger l'app, on déploie ce serveur, on fait pointer
`DATA_DIR` vers un stockage persistant et on ajoute une authentification.
