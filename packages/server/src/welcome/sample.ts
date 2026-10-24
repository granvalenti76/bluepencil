/**
 * The sample draft of the first start: written on purpose with something to find (a weak lead, a
 * percentage without a source, too many adverbs, a spelling mistake), so the editor has work to
 * do. It can be deleted like any file.
 */

const IT = `---
title: Il pane della domenica
archetype: blog
stage: writing
lang: it
target: 420
outline:
  - id: lead
    title: Lead
    target: 60
  - id: why
    title: Perché farlo in casa
    target: 120
    heading: Perché farlo in casa
  - id: how
    title: Come lo faccio
    target: 180
    heading: Come lo faccio
  - id: closing
    title: Chiusura
    target: 60
brief: >
  Un pezzo breve per il blog: perché faccio il pane in casa la domenica e come.
---
# Il pane della domenica

Ogni domenica mattina faccio il pane. È una cosa che faccio da anni e che mi piace molto.

## Perché farlo in casa

Il pane fatto in casa costa meno: secondo alcuni il 60% in meno di quello del forno. Inoltre è veramente molto più buono, e si sa esattamente cosa c'è dentro.

## Come lo faccio

- 500 g di farina tipo 1
- 350 g di acqua
- 10 g di sale e un cucchiaio di lievito madre

Lascio lievitare la notte in frigo, poi lo inforno la mattina a 250 gradi per quaranta minuti, perchè la crosta deve venire scura.

Il resto lo racconto la prossima volta.
`;

const EN = `---
title: Sunday bread
archetype: blog
stage: writing
lang: en
target: 420
outline:
  - id: lead
    title: Lead
    target: 60
  - id: why
    title: Why bake at home
    target: 120
    heading: Why bake at home
  - id: how
    title: How I do it
    target: 180
    heading: How I do it
  - id: closing
    title: Closing
    target: 60
brief: >
  A short blog post: why I bake bread at home on Sundays, and how.
---
# Sunday bread

Every Sunday morning I bake bread. It's something I've done for years and that I really like.

## Why bake at home

Home-made bread costs less: some say 60% less than the bakery's. It's also really much tastier, and you know exactly what goes into it.

## How I do it

- 500 g of flour
- 350 g of water
- 10 g of salt and a spoonful of sourdough starter

I let it rise overnight in the fridge, then bake it in the morning at 250 degrees for forty minutes, becuase the crust has to come out dark.

I'll tell you the rest next time.
`;

export function sampleDraft(lang: string): { path: string; text: string } {
  return lang === "en" ? { path: "Example.md", text: EN } : { path: "Esempio.md", text: IT };
}
