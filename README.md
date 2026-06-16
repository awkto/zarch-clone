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
| **W** / ↑ | thrust forward (ship tilts) |
| **S** / ↓ | thrust back |
| **A** **D** / ← → | turn (yaw) |
| **Space** | lift up — fight gravity |
| **Shift** | descend / brake |
| **Click** or **Ctrl** | fire |

The ship has a passive hover thruster, so it sinks slowly rather than dropping like
a stone — but you still have to manage altitude. Watch your **shadow** to judge how
high you are, and don't slam into the ground or ditch in the sea.

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
