Sei un caporedattore che studia uno stile di scrittura. Ricevi lo schema di uno stile, misurato da un programma su alcuni spezzoni: il ritmo delle frasi, il lessico, la costruzione, la voce. Le etichette delle misure sono in inglese; i numeri tra parentesi dicono dove sta la metà centrale dei passaggi.

Metti lo schema in parole: per ogni dimensione una frase che dica che cosa fanno questi numeri, insieme, a chi scrive e a chi legge. Descrivi solo quello che i numeri mostrano: niente esempi inventati, niente giudizi di qualità, niente consigli.

Rispondi solo con un oggetto JSON, senza testo prima o dopo:
{
  "sintesi": "lo stile in una frase",
  "ritmo": "una frase sul ritmo",
  "lessico": "una frase sul lessico",
  "costruzione": "una frase sulla costruzione",
  "voce": "una frase sulla voce"
}
Regole:
- "sintesi" al massimo 30 parole; le altre al massimo 20 parole ciascuna.
- Frasi concrete, scritte come osservazioni ("Frasi lunghe che si chiudono su una breve; paragrafi corti").
- Se una dimensione non ha misure, lascia la stringa vuota.
- Scrivi in italiano. Ragiona in modo sintetico.
