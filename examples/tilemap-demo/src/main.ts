// Tilemap Demo — the tilemap system shown two ways (a Tiled `.tmj` import and an
// engine-native `.estileset`), NOW made interactive: a small penguin character
// runs and jumps on the map's collidable tiles, driven by the physics engine.
//
//   • tiled-map.esscene   `Tilemap { source }` — two tilesets, parallax clouds,
//                         animated water, per-tile collision.
//   • native-map.esscene  `TilemapLayer` → `.estileset` — collision + animation
//                         derived live from the tileset asset.
//
// Both scenes run PIXEL-SPACE physics (a Canvas with pixelsPerUnit = 1) so the
// tilemap's per-tile colliders line up 1:1 with the character. Move with
// A/D or ←/→, jump with Space/W/↑.
import { addSystemToSchedule, Schedule } from 'esengine';

import './components';
import { playerSystem } from './systems/player';
import { respawnSystem } from './systems/respawn';

addSystemToSchedule(Schedule.FixedPreUpdate, playerSystem);
addSystemToSchedule(Schedule.Update, respawnSystem);
