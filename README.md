# VIRUS — a Zarch / Virus clone

A browser remake of David Braben's *Zarch* (released on other platforms as *Virus*):
hover a ship over a fractal island and destroy the alien **seeders** before their
virus rots the whole landscape.

No build step, no dependencies. The 3D is a hand-written software renderer drawing
flat-shaded polygons onto a 2D `<canvas>` — exactly the look of the 1987 original.

## Play

Just open `index.html` in any modern browser:

```
xdg-open index.html      # Linux
open index.html          # macOS
```

Or serve the folder (any static server works):

```
python3 -m http.server 8000   # then visit http://localhost:8000
```

## Controls

| Key | Action |
| --- | --- |
| **W** / ↑ | tilt nose down (lean forward) |
| **S** / ↓ | tilt nose up (lean back) |
| **A** **D** / ← → | turn left / right |
| **Space** | boost — fire the thruster |
| **Shift** | descend / brake |
| **Click** or **Ctrl** | fire weapon |

Flight works like the real *Zarch*: the ship has a single downward thruster.
**Tilting alone doesn't move you** — it just aims the thruster. Hold **Space** to
boost, and the thrust splits between lifting you up and driving you along: level =
pure lift, leaned over = mostly horizontal. So to fly forward you hold **W** *and*
**Space** together. A passive hover keeps you from dropping like a stone, but you
still manage altitude — watch your **shadow**, and don't slam into the ground or
ditch in the sea.

## Goal

- **Seeders** fly in from the edges and drop seeds that infect the land (it turns
  brown and the rot spreads to neighbouring tiles).
- **Shoot the seeders** (+100) before they spread the virus.
- **Shoot infected ground** to cure it (+points per tile cured).
- Survive the rising waves. If infection covers **60%** of the island, it's lost.
- You have 3 lives; crashing or colliding with a seeder costs one.

## Files

- `index.html` — page, HUD, menus, styling
- `game.js` — renderer, terrain generation, physics, enemies, virus logic
