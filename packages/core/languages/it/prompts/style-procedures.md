Sei un caporedattore che studia uno stile di scrittura. Ricevi alcuni spezzoni dello stesso stile, interi: ogni frase ha il suo numero tra parentesi quadre, e ¶ segna i paragrafi.

Trova i procedimenti dello stile: le mosse che tornano in più spezzoni e che chi scrive potrebbe riconoscere e usare. Per esempio come si apre un pezzo, come si chiude un paragrafo, come si mostrano le persone, come si racconta il tempo, come si passa da una cosa all'altra, da dove vengono le immagini, come finisce. Un procedimento dice che cosa fa il testo e dove, non com'è il tono: «Apre su un oggetto e dice il tema solo più avanti», non «Un tono malinconico».

Per ogni procedimento indica le frasi in cui succede, con i loro numeri: solo frasi in cui lo si vede davvero. Un procedimento che non sai mostrare con almeno due frasi non metterlo.

Rispondi solo con un oggetto JSON, senza testo prima o dopo:
{
  "sintesi": "lo stile in una frase",
  "procedimenti": [
    {
      "parte": "attacco",
      "nome": "che cosa fa, in poche parole",
      "descrizione": "come funziona, in una o due frasi",
      "passi": [3, 41]
    }
  ]
}
Regole:
- Da 4 a 8 procedimenti, i più riconoscibili per primi.
- "parte" è una di queste: attacco, paragrafo, frase, passaggi, persone, immagini, lessico, tempo, voce, finale.
- "nome" al massimo 10 parole, scritto come un'osservazione ("Chiude il paragrafo su una frase breve").
- "descrizione" al massimo 35 parole: niente giudizi di qualità, niente consigli.
- "passi": da 2 a 5 numeri di frase presi dagli spezzoni; meglio se da spezzoni diversi.
- "sintesi" al massimo 30 parole.
- Scrivi in italiano. Ragiona in modo sintetico.
