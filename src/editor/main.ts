// The level editor page for the built-in maps (dev server only: npm run dev, then open
// /editor.html). Save writes the map file through the dev server; Test opens the game at a
// chosen spot. The game reloads by itself when a map file changes. Players get the same
// editor inside the game, for their own maps (the map maker).

import '@fontsource/tiny5/400.css';
import { createEditor } from './editor';

createEditor(document.getElementById('editor')!, { kind: 'dev' });
