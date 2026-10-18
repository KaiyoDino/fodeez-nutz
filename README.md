# Fodeez Nutz

A Foddian climbing game. The dude uses a wheelchair, so he never stops rolling. His grappling hook is a plunger gun. There are no checkpoints, and the only way out is up.

This is a full remake of a 2023 high school final project ([the original Java game](https://github.com/SheebeesLaka/FINALPROJECT)). The first map and the Original mode's mechanics come from the original. The art, sound, menus, physics code, the New Age mode and a second map are new.

## Play

```bash
npm install
npm run dev        # http://localhost:5173
```

`npm run build` writes a static site to `dist/` that can be hosted anywhere (GitHub Pages, itch.io, any web server). All paths are relative.

`npm run build:single` also writes `dist/fodeez-nutz.html`: the whole game in one 160 KB file that plays when you open it, with no server needed.

**Controls**

| | |
|---|---|
| Click / tap | Fire the plunger toward the pointer |
| Hold | Hang on (New Age: get reeled in) |
| Release | Let go |
| Space | Same as the mouse button, aimed at the pointer |
| Esc | Pause |
| F | Fullscreen |

Your run saves automatically (like Getting Over It), so you can close the tab and continue later. There are still no checkpoints.

Browsers don't allow sound until the page gets a click or key press, so the game opens on a *Click to start* screen and the music begins with that click (it's skipped when the browser allows autoplay). Settings has volume, the aim guide, the crosshair size (small, medium, large) and the zoom (far shows 1920 × 1080 world units like the original on a 1080p screen; normal, the default, is 1.25× closer; close is 1.5×).

## Two maps

**The Tower** is the original 2023 map, transcribed platform for platform from `MainFrame.java` (`src/sim/maps/tower.ts`). It was built around the original physics.

**The Crane** (`src/sim/maps/crane.ts`) is a new climb up the tower crane next to the building, from the end of the night into dawn. It was designed around New Age physics, and around being fair to a person: the main route never needs a precisely timed release (holding until the rope lets go works), ledges are wide and stacked so a missed shot usually costs one ledge rather than the whole climb, and each section starts on a rest ledge with bumpers, where he rolls back and forth while you line up the shot.

1. **The Yard:** grapple up a zig-zag of ledges.
2. **The Mast:** the same, plus one spot where you chain two shots in one jump.
3. **The Chimney:** a shaft between two goop walls. A shot at a target near one wall flings you into the other; zig-zag up and out over the shorter wall.
4. **The Zip Line:** chain three shots left across a gap, onto a goop wall.
5. **The Spring Garden:** one-way bounce pads. Each bounce refills your shots; at the top of a bounce, shoot up and to the right onto the next pad.
6. **The Jib:** monkey-bars under the crane's arm, from goop pad to goop pad, then a last shot onto the hook block.

Both modes can be played on both maps. The route-finder bot (below) beats every combination, held to human limits. Its winning runs are in the game's Replays menu:

| | Original | New Age |
|---|---|---|
| The Tower | 24.5 s, 18 shots | 23.4 s, 21 shots |
| The Crane | 25.6 s, 32 shots | 28.3 s, 37 shots |

None of these runs falls or gets sent back by goop. A person won't be this quick, but every move in them can be done with human timing. Original's yank is strong enough that the Crane needed no Original-only changes.

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

**New Age** has new physics on the same maps:

- **Pull and fling.** Once the plunger sticks, holding reels you toward it, faster the longer you hold (6 up to 16 px/tick). Your sideways momentum fades while you're reeled in, so you go where you aimed instead of orbiting the plunger. When your hand reaches it, it lets go and you fly on in the direction it pulled you: a target up and to the right flings you up and to the right, past it. Letting go early keeps whatever speed you have, plus a small hop. The rope never stretches, so if it goes taut you swing.
- You can fire in any direction. The plunger flies past a target that's already at your hand. You get 3 grapples per airtime, refilled by landing, goop or a spring pad.
- Speeds are smooth, falling has a top speed, and landings are damped.
- Springs still multiply by 1.75, but always give at least a small boing and never exceed a cap. Spring pads are one-way from below, and a bounce puts you back to rolling pace sideways, so pads send you up rather than off to the side.
- You ride moving platforms properly, rolling relative to them.
- Goop holds you while you slide off slowly (15 px/s). After 160 ticks it drops you.

(The first New Age rope was a pendulum you wound in. A target ahead of you flung you backwards on the swing back, which felt wrong, so it was rebuilt as above.)

In the original, the only way from area 2 into area 3 was to hook the troll target and slide along the underside of the floor. The reversed-gravity pull pinned him to the ceiling while his horizontal speed carried him about 1,600 px right. A real rope can't do that, so New Age adds a short ladder up the empty right side of area 2: four targets and one goop patch (the New Age-only pieces at the end of `src/sim/maps/tower.ts`). The rest of the map is identical.

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
- **How much of the map you saw depended on your monitor size.** The view is now set by the Zoom setting instead (1920 × 1080 world units at "far", 1.25× and 1.5× closer at "normal" and "close"). On phones it shrinks further so the art stays readable.
- **Escape quit the program.** It now pauses. The teleport keys only work in debug mode.
- **A plunger fired just before the goop timer ran out survived the trip back to the start** and yanked him straight back up the map. Being sent back now drops the plunger (Original).

## Editing the levels

The maps are plain data: each piece is one line in `src/sim/maps/tower.ts` or `src/sim/maps/crane.ts`, like `g(1450, 5470, 260, 40, 1)` (a girder: x, y, width, height, area) or `t(1780, 5230, 1)` (a target, always 25 × 25). x and y are the top-left corner in world units, and y grows downward. The dude is 46 × 50 and the plunger reaches 350.

The easiest way to change them is the level editor:

```bash
npm run dev        # then open http://localhost:5173/editor.html
```

- Click a piece to select it, drag it to move it, and drag its yellow handles to resize it. Drag empty space (or right-drag) to pan, and scroll to zoom.
- The panel adds girders, targets, goop, spring pads, bumpers and teleport points, and edits a piece's position, size, area, whether it moves, which modes it exists in, and a note.
- The start, the goop reset point and the teleports (debug keys 1-9) can be dragged too. Circles show the plunger's reach around each target.
- **Save** (Ctrl+S) rewrites the map file through the dev server; only the part between `// <editor>` and `// </editor>` is touched. **Test here** (or T at the mouse) opens the game at that spot in a new tab, in the mode chosen in the panel.
- Del deletes, Ctrl+D duplicates, Ctrl+Z / Ctrl+Y undo and redo, arrows nudge, Alt drags without the grid.

On the Tower, the list order matters in Original mode (collisions are resolved in list order, like the 2023 game), so the editor adds new pieces after the others in the same area. Background decorations (signs, lamps, the crane's mast) are drawn in code in `src/render/level-art.ts` and don't move with the pieces.

After changing a map, its bot replay no longer matches: the Replays menu marks it as an older version, and `npm test` reports it. Re-run the bot for that map (below), or delete its file in `src/data/routes/`.

## Tests

```bash
npm test            # unit tests for both physics modes, plus replays of a recorded winning route per mode
npm run test:e2e    # browser tests (Playwright, using the installed Microsoft Edge)
npm run typecheck
```

**Route finder.** `tests/route-finder.ts` is a bot that searches for a winning route with a beam search over "aim at a target, hold N ticks, let go" moves. It's held to human limits: at least 0.2 s between letting go and the next shot, every press held at least 0.1 s, and every move must still work when it's done a little worse (pressed 2 ticks early or late, held 3 ticks longer or shorter, aimed 6 px off). A move that only works frame-perfectly is scored by its worst version, so the search avoids it. `FIND_ROUTE=tower-newage npm run route` finds a route (also `FIND_ROUTE=crane` for both modes, or `FIND_ROUTE=all`) and saves it to `src/data/routes/`. Those files are the bot replays in the game, and `npm test` replays them, so any physics or map change that makes a map unbeatable fails the tests.

**Section checks.** `SECTIONS=crane-newage npx vitest run tests/_sections.test.ts` runs the bot on each section separately (from a teleport point to the next section; `SECTIONS=tower-original` works too) and writes `tests/_sections_<map>-<mode>.txt`. Much faster than a full route when tuning one part of a map.

**Move windows.** `MOVES=crane-newage npx vitest run tests/_moves.test.ts` measures how forgiving each designed move of the Crane is: it rolls the dude back and forth on the ledge (or lets him slide down the goop, or bounce) and tries the shot on every tick, holding until the rope lets go. It reports the widest window of time in which the shot works; about 150 ms is comfortable, under 50 ms is hard. `TUNE="garden 3"` tries the move's target all around its current spot and lists the positions with the widest windows. That's how the Crane's targets were placed. `FEEL=new npx vitest run tests/_feel.test.ts` measures single grapples in both modes (rolling along, a target at various offsets, hold until the rope lets go): how long the pull takes, how fast you leave, and where you come down.

**Debug mode.** Add `?debug` to the URL. The number keys teleport between sections, as the original's dev keys did. Extra parameters for screenshots:

- `map=tower|crane` picks the map.
- `mode=original|newage` starts a run.
- `at=x,y` places the dude.
- `ticks=N` simulates N ticks before the first frame.
- `freeze` stops the simulation.
- `pointer=x,y` fakes the cursor position.
- `menu=pause|win|maps|modes|replays|watch|settings|howto` opens a screen (`watch` plays the bot's New Age run on `map`).

`npx playwright test --config tools/screens.config.ts` saves screenshots (phone, tablet, rope, goop) to `screenshots/`, prints CPU and frame-time measurements (`--grep perf`), checks the single-file build (`--grep single`) and the level editor (`--grep editor`), and draws a whole map with its targets numbered (`OVERVIEW=crane --grep overview`; `/tools/overview.html?map=crane` on the dev server does the same).

## Project layout

```
src/sim/       simulation: maps, Original and New Age physics, the Sim facade, replays (no DOM)
src/sim/maps/  the two maps
src/data/      the bot's winning routes (shown as replays in the game)
src/render/    pixel-art renderer: palette, bitmap font, sprites, level art, sky, particles, camera, HUD
src/audio/     synthesized sound effects and music (Web Audio)
src/game/      game loop, input, menus, saving
src/editor/    the level editor (dev server only) and the code it writes into the map files
tests/         unit tests, the route-finder bot, section checks, move windows
tools/         screenshot and performance scripts, the editor's save endpoint, the map overview page
e2e/           browser tests
```

Everything you see and hear is made in code. There are no image or audio files besides the favicon. The figures near the top of the tower are homages to Getting Over It, Jump King and Pogostuck.
