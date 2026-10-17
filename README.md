# Fodeez Nutz

A Foddian climbing game. The dude uses a wheelchair, so he never stops rolling. His grappling hook is a plunger gun. There are no checkpoints, and the only way out is up.

This is a full remake of a 2023 high school final project ([the original Java game](https://github.com/SheebeesLaka/FINALPROJECT)). The map and mechanics come from the original. The art, sound, menus and physics code are new.

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

**Route finder.** `tests/route-finder.ts` is a bot that searches for a winning route with a beam search over "aim at a target, hold N ticks, let go" moves. `FIND_ROUTE=original npm run route` (or `newage`, or `both`) finds a route and saves it to `tests/routes/`. `npm test` replays those routes, so any physics change that makes the map unbeatable fails the tests. Re-run the finder after deliberate physics changes.

**Debug mode.** Add `?debug` to the URL. Keys 1–4 teleport to the four areas, as in the original. Extra parameters for screenshots:

- `mode=original|newage` starts a run.
- `at=x,y` places the dude.
- `ticks=N` simulates N ticks before the first frame.
- `freeze` stops the simulation.
- `pointer=x,y` fakes the cursor position.
- `menu=pause|win|modes|settings|howto` opens a screen.

`npx playwright test --config tools/screens.config.ts` saves screenshots (phone, tablet, rope, goop) to `screenshots/`, prints a frame-time measurement (`--grep perf`), and checks the single-file build (`--grep single`).

## Project layout

```
src/sim/       simulation: level data, Original and New Age physics, the Sim facade (no DOM)
src/render/    pixel-art renderer: palette, bitmap font, sprites, level art, sky, particles, camera, HUD
src/audio/     synthesized sound effects and music (Web Audio)
src/game/      game loop, input, menus, saving
tests/         unit tests, route finder, recorded routes
e2e/           browser tests
```

Everything you see and hear is made in code. There are no image or audio files besides the favicon. The figures near the top of the tower are homages to Getting Over It, Jump King and Pogostuck.
