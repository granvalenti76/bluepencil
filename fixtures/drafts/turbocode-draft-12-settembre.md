---
title: Turbocode V0.6
archetype: article
stage: writing
target: 900
outline:
  - id: lead
    title: Lead
    target: 70
  - id: context
    title: Contesto
    target: 130
    heading: Cosa è Turbocode
  - id: development
    title: Sviluppo
    target: 650
  - id: closing
    title: Chiusura
    target: 50
sources:
  - fatti.md
  - https://github.com/turbocode
brief: >
  Presentare la 0.6 di Turbocode a chi usa modelli locali su Mac: cosa cambia e perché conta.
glossary:
  - Turbocode
  - llama-server
  - Qwen3.6-35B-3B
  - Q3_XSS
style:
  - Frasi brevi, niente prima persona nel lead.
---
# Turbocode V0.6

Turbocode è un agent harness locale per macOS che gira con modelli linguistici locali, con opzione di fallback cloud.

## Cosa è Turbocode

È un harness completamente scritto in Swift, concepito attorno a due principi: un consumo di memoria contenuto e un loop agentico ottimizzato per i modelli locali.

<!-- section: development -->In una sessione tipica consuma tra i 100 e i 150 MB di RAM, una cifra che permette l’uso prolungato senza pesare sul sistema. Funziona con llama-server abbinato a modelli come Qwen3.6-35B-3B Q3_XSS, con un contesto di 100k token.

Modelli più piccoli come Gemma-4E4 o Qwen3.5-9B sono utilizzabili, ma non garantiscono un loop autonomo completo. Per lavori più complessi si può integrare modelli cloud.

Il loop agentico di Turbocode parte da un'idea semplice: un modello locale ha meno contesto e meno pazienza di uno cloud, quindi ogni passaggio deve costare poco. Per questo l'harness divide il lavoro in passi brevi, riassume ciò che è già stato fatto e rimanda al modello solo ciò che serve davvero per il passo successivo. Il risultato è una sessione che resta leggibile anche dopo molte ore, senza che la cronologia riempia la finestra di contesto e faccia deviare le risposte verso dettagli ormai irrilevanti. In pratica significa meno attesa tra un passo e il successivo, e meno occasioni in cui il modello perde il filo di ciò che stava facendo.

La versione 0.6 porta soprattutto tre cambiamenti. Il primo riguarda la gestione della memoria: le strutture temporanee vengono rilasciate appena il passo che le ha prodotte è concluso, e questo tiene bassa la curva di consumo anche quando la sessione si allunga. Il secondo riguarda gli strumenti, che ora dichiarano in anticipo cosa possono leggere e scrivere. Il terzo riguarda i profili, cioè gruppi di impostazioni che si cambiano con un solo comando e permettono di passare da un modello all'altro. Nessuna di queste modifiche cambia il modo di lavorare già noto: chi usava la 0.5 ritrova gli stessi comandi, con meno sorprese nelle sessioni più lunghe.

Dal punto di vista di chi lo usa ogni giorno, la novità più evidente è la regolarità. Prima della 0.6 capitava che una sessione lunga rallentasse senza una ragione chiara, e che il modello cominciasse a ripetere azioni già compiute. Adesso l'harness tiene traccia dei passi svolti e interrompe i giri a vuoto, chiedendo conferma prima di riprovare. È un intervento piccolo, ma cambia il modo in cui ci si fida dello strumento quando lo si lascia lavorare da solo per qualche minuto. Chi ha provato le versioni preliminari riferisce che la differenza si nota soprattutto la sera, quando le sessioni si prolungano e la stanchezza lascia meno spazio ai controlli.

Resta da chiarire quanto questo approccio dipenda dal modello scelto. Con i modelli più grandi il loop si comporta bene e raramente ha bisogno di correzioni. Con quelli più piccoli la qualità dipende molto dal compito: le operazioni circoscritte, come leggere un file o applicare una modifica puntuale, riescono quasi sempre, mentre i lavori in più tappe richiedono una supervisione più attenta. Per questo i profili includono anche una soglia di prudenza, che si alza quando il modello è piccolo. La regola pratica, per ora, è scegliere il profilo in base al compito e non soltanto in base alla macchina disponibile.

Un altro aspetto riguarda la rete. Turbocode non chiama servizi esterni per impostazione predefinita: il modello gira sulla stessa macchina o su un server della rete locale, e il fallback cloud va attivato in modo esplicito. Chi lavora con codice riservato può quindi usarlo senza preoccuparsi che porzioni di file lascino il perimetro che ha scelto. Quando il fallback è attivo, l'interfaccia lo mostra in modo evidente, così non si resta a lungo in una modalità senza accorgersene.

Sul fronte dell'esperienza d'uso, il lavoro più lungo ha riguardato i messaggi di errore. Un harness che parla con un modello locale incontra molti modi di fallire: il server non risponde, la risposta è troncata, il formato non è quello atteso. Ognuno di questi casi ha ora un messaggio che dice cosa è successo e cosa si può fare, senza costringere a leggere i registri. Sono dettagli che non fanno notizia, ma che separano uno strumento provato una volta da uno usato ogni giorno. Il testo di ogni messaggio è stato rivisto più volte, tagliando i tecnicismi e mantenendo solo i dettagli che aiutano a decidere cosa fare subito dopo.

Cosa manca, a questo punto, è soprattutto la misura. Le prove interne dicono che la memoria resta contenuta e che il loop è più stabile, ma servono confronti sistematici tra modelli, quantizzazioni e tipi di compito. Il prossimo ciclo di lavoro andrà in questa direzione: una piccola suite di scenari ripetibili, da eseguire a ogni versione, per sapere con numeri e non con impressioni se un cambiamento migliora davvero la vita di chi scrive codice con un modello locale.
