@echo off
cd /d "%~dp0"
python -c "import flask" 2>nul || python -m pip install -r requirements.txt
rem --open ouvre le navigateur une fois le serveur pret
python app.py --open
rem Si l'app s'arrete sur une erreur (port deja utilise...), garder la fenetre ouverte pour la lire
if errorlevel 1 pause
