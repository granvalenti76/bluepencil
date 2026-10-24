# Adding a language to Bluepencil

Bluepencil ships with **English** and **Italian**. Everything that depends on the language of a
draft (what the model is told, the types of text and their sections, the readability index, the
words ignored when searching sources, the few words Bluepencil writes into a draft) lives in a
**language pack**: a folder of plain text files. You can add a language without touching the code.

## Quick start

1. Open **Settings ▸ Languages ▸ New language…**, type a code (`es`, `pt-BR`, `de`…) and a name
   (`Español`). Bluepencil copies the English pack into your folder
   (`~/.config/bluepencil/languages/<code>/`) and opens it in Finder.
2. Translate the files (see below) with any text editor.
3. Save. Bluepencil reloads the packs by itself (or use **Reload**). If a file has a problem,
   Settings ▸ Languages shows which file and why, and the pack isn't used until it's fixed.
4. Pick the language when you create a draft, or on the Structure screen. A draft's language is
   the `lang` field of its front matter.

## The files

```
<code>/
  language.json
  prompts/
    system.md  structure.md  structure-score.md  facts.md  grammar.md  prose.md
    prose-score.md  focus.md  outline.md  section.md  rewrite.md  repair.md
    letter.md      (optional: the editor's letter)
    labels.json  tools.json
  archetypes/
    article.json  blog.json  report.json  docs.json
  README.md        (optional, for you)
```

Any other file is an error, so that a misspelled name (`prompt/grammar.md`) doesn't go unnoticed.
Hidden files (`.DS_Store`) are ignored. Symbolic links are not allowed.

### language.json

| Field              | What it is                                                                                                                                                                                                      |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `code`             | The language code, BCP 47 (`es`, `pt-BR`, `it-x-mine`). It must match the folder name.                                                                                                                          |
| `name`             | The name of the language, in the language itself (`Español`). Shown in the language menu.                                                                                                                       |
| `promptVersions`   | One version per prompt (`system`, `structure`, `facts`, `grammar`, `prose`). For your own pack you don't need to bump them: any change to a file already invalidates the cached checks in this language.        |
| `readability`      | The readability formula (see below).                                                                                                                                                                            |
| `wordsPerMinute`   | Reading speed for the reading time (230 is a common value).                                                                                                                                                     |
| `opinionNote`      | The footnote Bluepencil writes for **Mark as opinion** (`Author's assessment.`).                                                                                                                                |
| `untitledSlug`     | File name for a draft whose title has no Latin letters (`draft`). Lowercase letters, digits, dashes.                                                                                                            |
| `capitalizedNames` | `true` if a capitalized word suggests a proper name. Set `false` for German, where all nouns are capitalized.                                                                                                   |
| `stopWords`        | Common words to ignore when searching the sources for facts.                                                                                                                                                    |
| `commonWords`      | The 30–40 most frequent words of the language (articles, prepositions, conjunctions). Bluepencil counts them to recognize the language of a draft and offer to switch. Avoid words shared with other languages. |
| `intensifiers`     | Optional. Intensifying adverbs (`really`, `completely`): Bluepencil counts them across drafts as a writing habit. Without it, that habit is not shown.                                                          |

### Readability

Choose one:

- `{ "formula": "sentences" }`: average words per sentence and how many sentences are long. No
  score: the right choice if your language has no standard formula. New packs start with this.
- `{ "formula": "flesch", "base": …, "perSentence": …, "perSyllable": …, "vowels": "aeiou", "silentE": false }`:
  Flesch Reading Ease and its adaptations, `base − perSentence × words/sentences − perSyllable ×
syllables/words`. Syllables are counted as groups of `vowels` (lowercase, without accents:
  accents are removed first); `silentE` drops a silent final _e_ (English, French). Known
  coefficients:
  - English (Flesch): 206.835, 1.015, 84.6
  - Spanish (Szigriszt-Pazos, INFLESZ): 206.835, 1, 62.3
  - French (Kandel and Moles): 207, 1.015, 73.6
  - German (Amstad): 180, 1, 58.5
- `{ "formula": "gulpease" }`: the Gulpease index, calibrated on Italian.

### prompts/*.md

What the model is told, one file per task. Write them in your language and ask the model to
answer in it ("Write in Spanish"). Keep:

- the **placeholders** in double braces. Each file accepts only its own:

  | File           | Placeholders                                                                        |
  | -------------- | ----------------------------------------------------------------------------------- |
  | `structure.md` | `{{genre}}` (required: how this type of text is built), `{{name}}` (its name)       |
  | `section.md`   | `{{context}}` (required: title, type, topic, glossary and style notes of the draft) |
  | `rewrite.md`   | `{{goal}}` (required: the chosen rewrite style), `{{context}}` (required)           |
  | `repair.md`    | `{{error}}` (required: what was wrong with the JSON)                                |
  | the others     | none                                                                                |

- the **tool and field names** the model must use: `annota`, `valuta` and `lettera`, `citazione`,
  `correzione`, `spiegazione`, `problema`, `proposta`, `osservazione`, `esito` with the values
  `verificato`, `da_verificare`, `senza_fonte`, `voto`, `motivo`, `testo`, and the JSON keys `sections`,
  `checks`, `title`, `target`, `guidance`, `text`, `alternatives`. They are the same in every
  language: this is how Bluepencil reads the answers.

Tell the grammar check which mistakes are typical of your language: it is the part that matters
most for quality.

`letter.md` is optional. With it, every check ends with a short letter to the author about the
whole text (what works, the main problem, what is left), shown at the top of the margin. It goes
together with `letter` and `letterText` in `tools.json`: all three, or none. Without them the
checks work as before, without a letter.

### prompts/labels.json and prompts/tools.json

Short texts around the prompts: the headings of the draft context, the labels of the messages, the
four rewrite styles, the lines of the structure and section proposals, the text Bluepencil adds to
a structure note (`notes.suggestion`), and the descriptions of the fields the model fills. Each
text accepts only the placeholders it already has in the English pack.

### archetypes/*.json

The four types of text, with their name, short name, the title and guidance of each section, the
checklist and the prose rules. Sections and checklist items are keyed by id (`lead`, `context`…):
keep the ids, translate the texts. Section shares, word targets and severities are the same for all
languages and live in the code.

## Rules

- **A pack can't replace a built-in language.** A folder named `it` or `en` in your folder is not
  loaded. For your own version, copy it to a private code such as `it-x-mine`.
- **Changing a file invalidates the cached checks in that language only.**
- A draft whose `lang` has no pack is treated as Italian, and the Readability panel says so.

## Sharing a pack

If your pack works well, propose it to the project: open a pull request that adds the folder to
`packages/core/languages/`. Built-in packs get the same checks as yours, plus the tests.
