# Dots

A fixture style for the gallery tests: every line is a row of round dots.

## What makes it read as dots

- Each line is a row of separate round dots, evenly spaced.
- One ink on a pale ground.

## Marks

- `dot(g, x, y, r, colour)`: one filled dot.
- `dotted(g, points, r, step, colour)`: dots every `step` units along a polyline.

## Creative direction

Space the dots by about twice their radius, so a line still reads as one line.

## Pitfalls

- Dots that touch read as a stroke, not as dots.
