---
type: knowledge
summary: "How to design an Artifex piece that answers a person: state first and changed only in step, ticks instead of a timeline, reactions planned as contacts with a sound cue, the margin that watches the game, keys and a drawn focus mark beside the pointer, describe for a screen reader, reduced motion, frame cost while playing, and checking a session by its saved file, film, still and time strip."
related_files: ["skills/artifex/SKILL.md", "docs/apis/piece-api.md", "core/play.js", "core/sound.js", "core/layer.js", "examples/noughts.js", "tools/build-page.js"]
---

# Interactive pieces

Read this with [the core skill](../SKILL.md) when a piece declares `play`.
The contract, the session file and the commands are in
[the piece API](../../../docs/apis/piece-api.md#interactive-pieces); this page
is how to make such a piece good. The example `noughts` is one, small enough
to read whole.

## Contents

- [State first](#state-first)
- [Ticks, not a timeline](#ticks-not-a-timeline)
- [Reactions are contacts](#reactions-are-contacts)
- [The whole frame answers](#the-whole-frame-answers)
- [Keys, focus and words](#keys-focus-and-words)
- [Reduced motion](#reduced-motion)
- [Frame cost](#frame-cost)
- [Check it from a saved session](#check-it-from-a-saved-session)

## State first

Write down what the state holds before any drawing: whatever the person's
input changes and when it changed, such as whose turn it is in a game, where
each placed thing sits in a toy, or what a tool has drawn so far. Every change happens in `play.step`, one
tick at a time, from the inputs of that tick and the seeded source `R`. `draw`
only looks, so it can be called at any time between ticks and in any order,
as an export does.

Keep the tick each thing happened on (`{ cell, who, tick }`), not a flag that
something is happening. `draw` then works out how far along each change is
from `t`, and the same state draws every moment of it.

A choice the piece makes for itself, an opponent's move or a gust, comes from
`R` with an address that never repeats, such as `R('reply', 'pick', move)`. A
wall clock, `Math.random` or the device makes a session that does not run
again.

## Ticks, not a timeline

A session has no length: it lasts as long as somebody plays. Time is `tick /
hz` seconds, 60 ticks a second unless the piece says otherwise. Give each
change a length in ticks and draw it growing over them: a mark drawn over a
third of a second (20 ticks) reads as drawn, one that appears at once reads as
stamped. A reply that waits half a second reads as thought about.

## Reactions are contacts

Plan each answer as a film plans a contact: the thing touched reacts, on the
tick it was touched, and the reaction carries a sound. Push the sound as a cue
onto `state.cues.sounds` in the same `step` that makes the change, with the
tick it plays at; the page plays it at once and the film renders it at that
tick. Give each cue its own `name`, or two cues share their noise.

Pick the voice from what is touched, as [sound](sound.md) says: a pen on paper
is noise through a few high modes (`shaker`), a knock is `impact`, a phrase is
`pluck` or `voice`. Keep repeated small sounds dry and quiet; give the moment
that matters most, such as the end of a round, the fuller sound and a little of the room (`wet`).

## The whole frame answers

What makes a played picture charming is often outside the part that is
played: something at the edge of the frame that answers too. It reads the
same state: a shape that leans toward the last pointer position, a change as
the turn or the mode changes, a reaction when it is pressed itself. Keep it to
one or two such things, each with a few clear states, and let every state come
from the session rather than from a timer.

## Keys, focus and words

Every action a pointer can take needs a key path. Arrows move a cursor;
Enter or Space acts under it. The piece draws its own focus mark, in its own
medium, while the keys are in use, and hides it when the pointer takes over.

`play.describe(state)` returns one sentence the page announces when it
changes: what the person can do now, what has changed, what is where, and
where the cursor is when the keys are in use. Write it for someone who cannot
see the picture.

## Reduced motion

`clock.reducedMotion` is true when the player asked for reduced motion. Hold
still what moves on its own, such as a slow turn or a bob; keep what the
player's input moves, since that is the piece answering. The saved session keeps the flag,
so its film shows what was played.

## Frame cost

The page draws every animation frame, so a frame over about 10 ms makes the
input feel late. Keep what never changes, the paper and the board, in one
`layer`; it is drawn twice and then put back as a copy. What settled for good
can go on a `sprite` keyed by how many things have settled. Draw only what moves
or grows each frame. Measure a played frame in the page before adding detail.

## Check it from a saved session

Play it in the page (`npm run page`), then **save session**. Everything that
judges a film then judges the session:

- `npm run film -- <piece> --session <file>` makes its film with sound, and
  `npm run replay` checks it.
- `npm run still -- <piece> --session <file> --at <seconds>` makes one frame.
- `npm run seeds -- <piece> --session <file>` lays its frames out as a time
  strip, so you can see every change grow and every reaction land.

Look at the strip at readable size before calling the piece done.
