---
type: knowledge
summary: "How to draw the light-painting style: a long night exposure with additive light trails that have a glow and a white-hot core, spun steel-wool sparks, a light orb and a rippled reflection in wet ground; read before making or adapting a light-painting piece."
related_files: ["skills/artifex/styles/light-painting.js", "skills/artifex/styles/kit.js"]
---

# Light painting

A long exposure at night: the subject traced in the air with hand-held
lights, the trails glowing over a dark scene and mirrored in wet ground.
Gallery `style` 14.

## What makes it read as light painting

- All light adds (`globalCompositeOperation = 'lighter'`): where trails
  cross they get brighter, never darker, and nothing covers anything.
- A trail has a wide faint glow, a narrower brighter one and a core that is
  nearly white, whatever the light's colour.
- A trail is a hand's path: slightly unsteady, brighter where the hand moved
  slowly, its colour drifting along its length.
- The scene round it is almost black and still: faint stars, a silhouette,
  a horizon. The only other lights are more light painting: sparks, an orb.
- Wet ground mirrors the lights, dimmer and broken sideways by ripples.

## Recipe

1. Sky: a vertical gradient to the horizon at 720, `#04050b`, `#0b0d1c` at
   0.75, `#1b1726`; ground `#0c0b12` to `#040407`; 160 faint stars; a tree
   line in `#07070d` from `fbm`; a thin glow along the horizon.
2. `trail(points, width, hue, bright)`: four passes over the path, each drawn
   in pieces of six points so the colour can follow `hue(t)`: width 7 at
   alpha 0.035, 3.2 at 0.09, 1.4 at 0.35, then the core 0.5 wide at 0.9,
   mixed 70% toward white. Round caps and joins. Every pass but the core
   is dimmed or brightened along the path by a slow product of two sines,
   the hand's changing speed.
3. The subject: each part a closed loop, smoothed once with Chaikin,
   resampled every 3 units and wobbled by 2.2 at a step of 14. The light is
   switched off between parts, so no stray line joins them. Width 5.
4. Colours that drift: the body from rose `#ff3d7f` to amber `#ffb13d` to
   pink `#ff5ad1`; the wing `#ffd23d` to `#ff8a3d`; the tail cyan `#40e0ff`
   to `#6f7bff`; the legs `#40e0ff`, 3 wide, from the body to the ground.
5. A held light: where the hand stopped, a radial glow of radius 34, white
   at the centre, `rgba(255, 220, 160, 0.8)` at a quarter, fading to orange.
   The reference puts it on the eye.
6. A second light for motion: a rising spiral from the beak, radius 10 to
   44, seven half-turns, `#b77dff` to `#6effc8`, 2.4 wide.
7. Steel wool: 380 sparks from one centre, each a streak of 12 segments
   along a bending arc that falls a little as it goes, 2.8 wide fading to
   0.6, alpha 0.63 falling to 0.08; a fifth of them white-hot `#fff2c0`,
   two fifths `#ffb347`, the rest `#ff7a2a`.
8. An orb: 16 rings of one colour at tilts round the vertical, each a trail
   1.6 wide at half brightness.
9. Reflection: clip to the ground, mirror every trail about the horizon,
   push each point sideways by 14 x (`fbm(x / 90, y / 8)` - 0.5), and draw
   at about a third of the brightness.

## Palette

| Role | Colours |
| --- | --- |
| sky, horizon, ground | `#04050b` `#0b0d1c` `#1b1726` `#0c0b12` `#040407` |
| silhouette | `#07070d` |
| warm lights | `#ff3d7f` `#ffb13d` `#ff5ad1` `#ffd23d` `#ff8a3d` |
| cool lights | `#40e0ff` `#6f7bff` `#4fd1ff` `#b77dff` `#6effc8` |
| sparks | `#fff2c0` `#ffb347` `#ff7a2a` |

## Pitfalls

- One continuous path through every part draws straight lines across the
  subject where the hand moved between parts. Switch the light off.
- A core at the light's own colour reads as neon tubing. It must go toward
  white.
- A trail thinner than a pixel at the output size vanishes into a dark disk;
  keep the core at least a pixel wide.
- Sparks overlapping the subject bury it: every light adds, so nothing can
  stand in front of anything else.
- A lit scene behind the lights is a photograph with effects, not a long
  exposure. Keep the ground and sky near black.

## Any subject

Trace each closed part of the subject as its own loop and give each part its
own colour range. Mark one point the light rested on, and put the scene's
other lights where the subject's silhouette is not.

## Reference

[`light-painting.js`](light-painting.js) draws gallery `style` 14; see the
[catalog](catalog.md) for the commands.
