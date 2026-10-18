# Fodeez Nutz

A Foddian climbing game. The dude uses a wheelchair, so he never stops rolling. His grappling hook is a plunger gun. There are no checkpoints, and the only way out is up.

This is a full remake of a 2023 high school final project ([the original Java game](https://github.com/SheebeesLaka/FINALPROJECT)). The first map and the Original mode's mechanics come from the original. The art, sound, menus, physics code, the New Age mode and a second map are new.

## Play

```bash
npm install
npm run dev        # http://localhost:5173
```

`npm run build` writes a static site to `dist/` that can be hosted anywhere (GitHub Pages, itch.io, any web server). All paths are relative.

`npm run build:single` also writes `dist/fodeez-nutz.html`: the whole game in one 120 KB file that plays when you open it, with no server needed.

**Controls**

| | |
|---|---|
| Click / tap | Fire the plunger toward the pointer |
| Hold | Hang on |
| Release | Let go |
| Space | Same as the mouse button, aimed at the pointer |
| Esc | Pause |
| F | Fullscreen |

Your run saves automatically (like Getting Over It), so you can close the tab and continue later. There are still no checkpoints.

## Two maps

**The Tower** is the original 2023 map, transcribed platform for platform from `MainFrame.java` (`src/sim/maps/tower.ts`). It was built around the original physics.

**The Crane** (`src/sim/maps/crane.ts`) is a new climb up the tower crane next to the building, from the end of the night into dawn. It was designed around New Age physics, especially the swing-and-release fling:

1. **The Yard:** ground level and a few ledges.
2. **The Mast:** a zig-zag of small ledges.
3. **The Chimney:** a shaft between two goop walls. Stick, slide, fire across, and climb out over the left wall.
4. **The Swing Line:** three targets over a long drop, crossed with flings, then a goop wall to catch you.
5. **The Spring Garden:** one-way spring pads you steer between with the plunger.
6. **The Jib:** monkey-bars along the underside of the crane's arm, into the hook block hanging off the end.

Both modes can be played on both maps. The route-finder bot (below) beats every combination. Its winning runs are in the game's Replays menu:

| | Original | New Age |
|---|---|---|
| The Tower | 18.5 s | 17.9 s |
| The Crane | 18.7 s | 86.8 s |

The bot has perfect timing, so these are far faster than a person will manage, but they show the shape of each map. Original's reversed-gravity yank is so strong on the Crane's open climbs that it needed no Original-only changes there.

## Two modes

**Original** keeps the 2023 physics, ported line by line from `MainFrame.java`:

- 60 ticks per second and whole-number speeds. Gravity is 1 px/tick², reversed while the hook is attached.
- Rolling speed settles between 3 and 4 px/tick and never stops. Walls bounce him back at 0.4×.
- You can only fire by clicking more than 25 px above him. The hook flies at 30 px/tick and gives up at 350 px.
- When the hook catches, his horizontal speed becomes the distance to the hook ÷ 9.
- Letting go gives a −10 boost and halves his horizontal speed. He lets go on his own once he's 50 px above the hook.
- 3 grapples per airtime.
- Springs multiply speed by 1.75 with no cap.
- Moving girders carry him at platform speed + 2.
- Goop holds him in place. Stay stuck for 160 ticks and you're sent back to the start, with no timer or warning shown.

**New Age** has new physics on the same map:

- The rope is a real pendulum. Holding winds it in, slowly at first and then faster. Letting go keeps your momentum and adds a small hop.
- You can fire in any direction. You still get 3 grapples per airtime, refilled by landing or by goop.
- Speeds are smooth, falling has a top speed, and landings are damped.
- Springs still multiply by 1.75, but always give at least a small boing and never exceed a cap. Spring pads are one-way from below.
- You ride moving platforms properly, rolling relative to them.
- Goop holds you while you slide off slowly (15 px/s). After 160 ticks it drops you.

In the original, the only way from area 2 into area 3 was to hook the troll target and slide along the underside of the floor. The reversed-gravity pull pinned him to the ceiling while his horizontal speed carried him about 1,600 px right. A real rope can't do that, so New Age adds a short ladder up the empty right side of area 2: four targets and one goop patch (`NEW_AGE_LADDER` in `src/sim/level.ts`). The rest of the map is identical.

## Replays

The simulation is deterministic, so a replay is just the map, mode, random seed and every press and release with its tick (`src/sim/replay.ts`). Every run records its inputs as you play, and the recording is saved with the run, so it survives quitting and continuing.

- **After a win**, *Watch replay* plays your run back at 4×.
- **The Replays menu** on the title screen has the bot's winning runs for each map and mode, and your fastest and most recent win.
- **While watching**, you can pause, change speed (1× to 16×), and seek with the slider or the arrow keys. Presses show as yellow squares where they landed.

## What was fixed from 2023 (both modes)

- **Falling through platforms at high speed.** Movement is now checked along the whole path.
- **Rolling from a standstill always went left.** `(int)(Math.random()*2)-1` can only give −1 or 0. The direction is now random.
- **A quick click gave a free mid-air boost.** The release boost now needs the hook to have actually caught.
- **Invisible platforms still caught or blocked the hook.** The hook now ignores anything that isn't there.
- **A moving girder could shove him through itself.** It now pushes him out the side it came from.
- **Softlocks.** Standing on top of goop now counts toward the goop timer (Original). Springs keep him rolling, so he can't bounce in place forever (New Age).
- **The trapdoor, plug and troll target flickered every tick** while he pushed against the hole. A small dead zone keeps the same trick without the flicker.
- **Winning didn't end the run.** It now does, with a results screen and best times.
- **How much of the map you saw depended on your monitor size.** You now always see at least 1920 × 1080 world units. On phones the view shrinks so the art stays readable, but never below 800 units.
- **Escape quit the program.** It now pauses. The teleport keys only work in debug mode.

## Tests

```bash
npm test            # unit tests for both physics modes, plus replays of a recorded winning route per mode
npm run test:e2e    # browser tests (Playwright, using the installed Microsoft Edge)
npm run typecheck
```

**Route finder.** `tests/route-finder.ts` is a bot that searches for a winning route with a beam search over "aim at a target, hold N ticks, let go" moves. `FIND_ROUTE=tower-newage npm run route` finds a route (also `FIND_ROUTE=crane` for both modes, or `FIND_ROUTE=all`) and saves it to `src/data/routes/`. Those files are the bot replays in the game, and `npm test` replays them, so any physics or map change that makes a map unbeatable fails the tests. Re-run the finder after deliberate physics or map changes.

**Section checks.** `SECTIONS=crane-newage npx vitest run tests/_sections.test.ts` runs the bot on each section of the crane separately (from a teleport point to the next section) and writes `tests/_sections.txt`. This is much faster than a full route when tuning one part of the map.

**Debug mode.** Add `?debug` to the URL. The number keys teleport between sections, as the original's dev keys did. Extra parameters for screenshots:

- `map=tower|crane` picks the map.
- `mode=original|newage` starts a run.
- `at=x,y` places the dude.
- `ticks=N` simulates N ticks before the first frame.
- `freeze` stops the simulation.
- `pointer=x,y` fakes the cursor position.
- `menu=pause|win|maps|modes|replays|watch|settings|howto` opens a screen (`watch` plays the bot's New Age run on `map`).

`npx playwright test --config tools/screens.config.ts` saves screenshots (phone, tablet, rope, goop) to `screenshots/`, prints a frame-time measurement (`--grep perf`), and checks the single-file build (`--grep single`).

## Project layout

```
src/sim/       simulation: maps, Original and New Age physics, the Sim facade, replays (no DOM)
src/sim/maps/  the two maps
src/data/      the bot's winning routes (shown as replays in the game)
src/render/    pixel-art renderer: palette, bitmap font, sprites, level art, sky, particles, camera, HUD
src/audio/     synthesized sound effects and music (Web Audio)
src/game/      game loop, input, menus, saving
tests/         unit tests, the route-finder bot, section checks
e2e/           browser tests
```

Everything you see and hear is made in code. There are no image or audio files besides the favicon. The figures near the top of the tower are homages to Getting Over It, Jump King and Pogostuck.
