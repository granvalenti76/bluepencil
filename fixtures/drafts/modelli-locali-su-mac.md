---
title: "Modelli locali su Mac: cosa cambia"
archetype: report
stage: writing
target: 2000
outline:
  - id: summary
    title: Sintesi
    target: 200
  - id: method
    title: Metodo
    target: 300
    heading: Metodo
  - id: results
    title: Risultati
    target: 900
    heading: Risultati
  - id: limits
    title: Limiti
    target: 300
    heading: Limiti
  - id: conclusions
    title: Conclusioni
    target: 300
    heading: Conclusioni
sources: []
brief: >
  Confrontare cosa si può fare oggi con modelli locali su un Mac con memoria unificata, rispetto a un anno fa.
---
# Modelli locali su Mac: cosa cambia

In questo report si confrontano alcuni modelli linguistici eseguiti in locale su un Mac con memoria unificata. L'obiettivo è capire quali compiti quotidiani di scrittura e programmazione si possono affidare oggi a un modello locale senza ricorrere al cloud, e a quale costo in tempo e memoria.

## Metodo

Ogni modello è stato eseguito con llama-server e quantizzazione a quattro bit, sulla stessa macchina e con lo stesso contesto. Per ogni modello si sono misurati la velocità di generazione, il tempo della prima risposta e la memoria occupata dopo dieci minuti di lavoro continuo.

I compiti di prova sono tre: riassumere un articolo di circa mille parole, correggere un testo con errori inseriti a mano e proporre una modifica a un piccolo file di codice. Ogni compito è stato ripetuto cinque volte per ridurre l'effetto del caso.

## Risultati

La velocità di generazione dipende soprattutto dalla dimensione del modello e dalla quantizzazione. I modelli da nove miliardi di parametri restano confortevoli per l'uso interattivo, mentre quelli più grandi diventano accettabili solo se sfruttano un'architettura a esperti, che attiva una frazione dei parametri per ogni parola.

Nella correzione di testi italiani tutti i modelli provati hanno individuato la maggior parte degli errori di ortografia, ma la qualità si differenzia sugli accordi e sulla punteggiatura.

Per i riassunti, il fattore decisivo è la lunghezza del contesto: oltre una certa soglia i modelli più piccoli cominciano a trascurare la parte centrale del testo, e il riassunto riflette soprattutto l'inizio e la fine. Sul codice, le modifiche circoscritte a una sola funzione riescono quasi sempre, mentre quelle che toccano più file richiedono un controllo umano accurato.

La memoria occupata cresce in modo regolare con la lunghezza della conversazione. Dopo dieci minuti di lavoro continuo la differenza tra i modelli è netta, e per chi usa il Mac anche per altro conta quanto il modello lasci libero per le altre applicazioni.

## Limiti

Il confronto riguarda una sola macchina e un numero ridotto di prove, quindi le differenze piccole tra modelli vicini non vanno considerate significative.
