# Ma Collection — registre horloger

App web installable (PWA) pour suivre une collection de montres : fiches détaillées,
photos, suivi d'entretien et wishlist. Elle fonctionne **hors ligne** et toutes les
données restent **sur l'appareil** : rien n'est envoyé sur internet.

## Installer sur un téléphone

Une fois l'app en ligne (GitHub Pages), ouvrir son adresse puis :

- **iPhone** : dans Safari, *Partager* → *Sur l'écran d'accueil*. Indispensable :
  installée, l'app marche hors ligne et iOS conserve ses données.
- **Android** : dans Chrome, menu *⋮* → *Installer l'application*.

## Fonctionnalités

- **Collection** : fiche complète (identité, mouvement, boîtier, achat et valeur),
  plusieurs photos par montre (réduites automatiquement), recherche, filtre par
  type de mouvement, tris, stats.
- **Entretien** : historique des interventions (révision, pile, étanchéité…),
  avec les coûts. La prochaine révision est calculée à partir de la dernière
  révision complète (ou de la date d'achat) et de l'intervalle choisi pour chaque
  montre (5 ans par défaut). Les montres en retard ou à prévoir dans les 6 mois sont signalées.
- **Wishlist** : prix cible, prix constaté (avec l'indication « dans le budget »),
  priorité, lien et photos. Le bouton « Je l'ai achetée » fait passer la montre
  dans la collection avec ses photos.
- **Sauvegarde** : un fichier unique (fiches + photos) à garder dans iCloud Drive,
  Google Drive…, et à restaurer sur le même ou un autre appareil. L'app rappelle
  de sauvegarder au bout de 30 jours.

## Fichiers

- `index.html`, `style.css`, `app.js` : l'interface (sans framework ni étape de build).
- `store.js` : le stockage sur l'appareil (IndexedDB), la sauvegarde et la restauration.
- `sw.js`, `manifest.webmanifest`, `icons/` : le mode hors ligne et l'installation.
- `outils/generer_icones.py` : régénère les icônes (Pillow).
- `outils/convertir_ancienne_base.py` : convertit les données de l'ancienne version PC
  (`data/montres.db`) en fichier de sauvegarde à restaurer dans l'app.

Le dossier `data/` (données personnelles) n'est jamais versionné.

## Tester en local

```bash
python -m http.server 5000
```

puis ouvrir http://localhost:5000. Après une modification mise en ligne, l'app
installée prend la nouvelle version au lancement suivant ; changer `CACHE` dans
`sw.js` force le renouvellement complet du cache.
