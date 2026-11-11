# Interview prep: Justin Smith

Prep sheet for an oral-history interview with Justin Smith (`data/people/justin-smith.yaml`).
Built per step 1 of [`docs/interview-workflow.md`](../interview-workflow.md): the "Gaps / questions
for interviews" section of `research/vancouver-indie-timeline-v2.md` plus the `open_questions` on
his events.

## Why he matters to this project

Enviro-Bear 2000 (2009) and Desert Golfing (2014) are two of the best-known games attached to the
Vancouver story — and his record is the single largest geography hole in the dataset. Every record
that touches him carries a caveat.

## Status before the interview

| Record | Status | Problem |
|---|---|---|
| `people/justin-smith` | verified | `vancouver.tie: unconfirmed`; no birth year |
| `orgs/blinkbat-games` | single-source | Who else was in it? Was he sole owner? |
| `orgs/captain-games` | verified | Formal relationship to Blinkbat undocumented |
| `games/enviro-bear-2000` | single-source | Dates rest on Wikipedia |
| `games/desert-golfing` | single-source | Dates rest on Wikipedia |
| `games/golf-on-mars` | single-source | Only a month ("2020-07"), no exact date |
| 5 events | caveated | All carry the geography caveat |

**Open question already in the data** (on four events): *"Were you living in Vancouver when you
made Enviro-Bear 2000 and Desert Golfing? Who else was in Blinkbat Games?"*

## Already on the record — don't burn time re-asking

From the three Game Developer interviews and Wikipedia (see `data/sources/`):

- Enviro-Bear was built in about two to three months for the TIGSource Cockpit Competition, in
  Visual C++ with HGE and Box2D; art drawn by hand in MS Paint; he expected "complete failure."
- It started as a squirrel; the one-handed grab came from the Box2D testbed.
- It won the most TIGSource user votes, was a 2010 IGF Nuovo finalist, and had a cabinet at
  Fantastic Arcade in Austin in 2010.
- iOS version (Enviro-Bear 2010) July 8, 2009. Desert Golfing August 6, 2014, PC/Mac
  December 19, 2017. Golf on Mars July 2020. Horsey Game February 18, 2026.
- In 2010 he said he lives in "Canada" — "We see bears up here pretty regularly." No city.
- Other titles mentioned in passing: *So Long, Oregon* and *No Brakes Valet*.

A 2014 Medium profile by Alec Thomson ("the mysterious Canadian Justin Smith") reportedly calls him
"Vancouver-based." It returned 403 and was never read — worth asking him whether it was accurate.

## Approach

He is famously low-profile; a 2014 profile called him mysterious. Expect a short interview and
possibly a written exchange rather than a recording. Lead with the work, not the biography, and keep
the location question matter-of-fact — it is a factual gap in a timeline, not a request for an
address. Consent is `not-asked`: agree the scope (bio, birth date, photo, quotes, audio clips) at
the top and note it in `data/interviews/<id>.yaml`.

---

## Questions

### 1. The geography question (the one that must be answered)

1. Where were you living when you made Enviro-Bear 2000 in 2009 — and when Desert Golfing came out
   in 2014? If it was Vancouver, when did you arrive, and from where?
2. Where are you based now?
3. A 2014 Medium profile described you as "Vancouver-based." Was that right at the time?
4. Should you be in a Vancouver indie history at all, in your view — or are you a Canadian developer
   people have assumed into the Vancouver story?
5. Did the city matter to the work at all, or could these games have been made anywhere?

### 2. Enviro-Bear 2000 (2009–2010)

6. How did you find the TIGSource Cockpit Competition, and what were you doing for a living then?
7. You've said you expected it to be a complete failure. When did you realize it wasn't?
8. What did the IGF Nuovo nomination actually change — money, attention, invitations, nothing?
9. Did going to Fantastic Arcade in Austin in 2010 connect you to anyone you kept working with?
10. Did any Canadian or Vancouver developers reach out after Enviro-Bear?
11. What happened to *So Long, Oregon* and *No Brakes Valet*?
12. What are the dates we should be using? Our April 4 and July 8, 2009 dates come only from
    Wikipedia.

### 3. Blinkbat Games and Desert Golfing (2014)

13. What was Blinkbat Games — a company, a label, a name on a store page? Who else was in it?
14. Were you the sole owner, and was anyone else credited on Desert Golfing (art, audio, porting,
    testing)?
15. Why the name Blinkbat, and why drop it?
16. Desert Golfing became a word-of-mouth hit. What did that look like from your side, and did it
    change how you worked?
17. Were you supporting yourself with it by then, or was there other work?
18. Who did the December 2017 PC and Mac versions?

### 4. Captain Games, Golf on Mars, Horsey Game

19. When did Captain Games start, and is it formally the successor to Blinkbat or just a new name?
20. What's the exact release date for Golf on Mars? We only have July 2020.
21. Horsey Game is a bigger, systems-heavy game than anything before it — how long was it in
    development, and did anyone else work on it?
22. It sits at Overwhelmingly Positive on Steam. Did that change anything about what you do next?
23. You've stayed solo across seventeen years. Was that a decision, or just how it worked out?
24. Have you ever had a publisher, funding, or a grant — and has the BC Interactive Digital Media
    Tax Credit ever been relevant to you?

### 5. The scene

25. Did you ever go to Full Indie meetups or the Full Indie Summit? (If yes: roughly which years,
    and who was there?)
26. Did you ever spend time at Indie House in Richmond, or know the people in it (Maddy Thorson,
    Chevy Ray Johnston, Noel Berry, Alec Holowka)?
27. Who in Canadian indie games were you actually in contact with between 2009 and 2014 — and was
    that mostly online (TIGSource forums) rather than in a city?
28. Did the 2009–2011 Vancouver studio layoffs touch anyone you knew, or push people you knew into
    going independent?
29. Is there a recognizable Vancouver or BC style, or is that a story journalists tell?
30. Has housing cost ever pushed you to think about leaving?

### 6. Being hard to find

31. Keeping a low profile — deliberate, or just not interesting to you?
32. Has being "the mysterious Canadian" ever helped the games?
33. What have people most often gotten wrong about you in print?

### 7. Admin, at the end

34. Birth year, or at least a decade — and is it okay to publish it?
35. Is there a photo we can use, and who holds the rights?
36. Do you have build archives, screenshots, jam-era forum posts or emails from 2009 worth keeping?
37. Who else should we talk to that we probably haven't thought of?

---

## After the interview

Feeds back into: `people/justin-smith` (`vancouver.tie`, birth year, memberships),
`orgs/blinkbat-games` (members, ownership, dates), `orgs/captain-games` (lineage to Blinkbat),
`games/golf-on-mars` (exact date), and the `caveat` / `open_questions` on all five of his events. If
he confirms he was never in Vancouver, the five events need their `region` and framing revisited —
`2026-02-18-horsey-game-released` is currently tagged `region: vancouver`.
