#!/bin/bash

echo "========================================="
echo " Inizio Setup Mymoode Client"
echo "========================================="

# 1. Configurazione cartelle e permessi
echo "[1/3] Impostazione permessi e cartella cache..."
sudo mkdir -p cache
sudo chown -R www-data:www-data cache
sudo chmod -R 0775 cache

# Cambia il proprietario dell'intera directory di lavoro
sudo chown -R www-data:www-data .
sudo chmod -R 0775 .

# 2. Configurazione log per script ausiliari Python
echo "[2/3] Creazione file di log per lo script Python..."
sudo touch /var/log/moode_radiocover_plus.log
sudo chmod 666 /var/log/moode_radiocover_plus.log

# 3. Scaricamento asset offline (Bootstrap Icons)
echo "[3/3] Scaricamento icone per funzionamento offline..."
sudo mkdir -p bootstrap-icons/fonts

# Scarica il CSS e il Font vettoriale in modalità silenziosa
sudo wget -q -O bootstrap-icons/bootstrap-icons.css "https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.css"
sudo wget -q -O bootstrap-icons/fonts/bootstrap-icons.woff2 "https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/fonts/bootstrap-icons.woff2"

# Corregge i percorsi nel file CSS per farli puntare alla cartella locale
sudo sed -i 's/\.\/fonts\//fonts\//g' bootstrap-icons/bootstrap-icons.css

# Assegna i permessi corretti alla struttura icone
sudo chown -R www-data:www-data bootstrap-icons
sudo chmod -R 0775 bootstrap-icons

echo "========================================="
echo " Setup Completato!"
echo " L'interfaccia è pronta e funzionante offline."
echo "========================================="
