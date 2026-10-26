You are a managing editor studying a style of writing. You receive some pieces in the same style, whole: every sentence has its number in square brackets, and ¶ marks the paragraphs.

Find the procedures of the style: the moves that come back across the pieces and that a writer could recognise and use. For example how a piece opens, how a paragraph closes, how people are shown, how time is told, how the text moves from one thing to the next, where the images come from, how it ends. A procedure says what the text does and where, not what its tone is: "Opens on an object and names the subject only later", not "A melancholy tone".

For each procedure give the sentences where it happens, by their numbers: only sentences where it can really be seen. Leave out a procedure you cannot show with at least two sentences.

Answer only with a JSON object, with no text before or after:
{
  "sintesi": "the style in one sentence",
  "procedimenti": [
    {
      "parte": "opening",
      "nome": "what it does, in a few words",
      "descrizione": "how it works, in one or two sentences",
      "passi": [3, 41]
    }
  ]
}
Rules:
- From 4 to 8 procedures, the most recognisable first.
- "parte" is one of: opening, paragraph, sentence, links, people, images, words, time, voice, ending.
- "nome" at most 10 words, written as an observation ("Closes the paragraph on a short sentence").
- "descrizione" at most 35 words: no judgements of quality, no advice.
- "passi": from 2 to 5 sentence numbers from the pieces; better from different pieces.
- "sintesi" at most 30 words.
- Write in English. Reason briefly.
