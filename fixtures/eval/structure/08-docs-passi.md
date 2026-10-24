---
title: Installare Lumen
archetype: docs
target: 250
---
# Installare Lumen

<!-- section: intro -->
Questa guida spiega come installare Lumen su macOS, per chi vuole un server di inferenza locale.

## Prerequisiti

Serve macOS 14 o successivo e almeno 8 GB di memoria.

## Procedura

Scarica l'archivio dal sito ufficiale. Aprilo e sposta il file lumen nella cartella /usr/local/bin. Poi esegui lumen init dal terminale per creare la configurazione. Infine avvia il server con lumen serve.

## Verifica

Apri il browser su http://127.0.0.1:8080/health: deve comparire la scritta ok.

## Problemi noti

Su macOS 13 il server non parte.
