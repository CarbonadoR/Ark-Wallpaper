import fs from "node:fs";
import path from "node:path";

const DEFINITIONS = {
  "rhodes-pattern": ["[uc]battlecommon", "topbar_origium_print_line_sheet.png"],
  "rhodes-time": ["[uc]common", "icon_time.png"],
  "lonetrail-orbit": ["hometheme", "[uc]tm_lonetrail_1", "ap_planet_line.png"],
  "lonetrail-mark": ["hometheme", "[uc]tm_lonetrail_1", "icon_rhodes.png"],
  "rainbowsix-grid": ["hometheme", "[uc]tm_rainbowsix_1", "dot_tile.png"],
  "rainbowsix-title": ["hometheme", "[uc]tm_rainbowsix_1", "title_terminal_sub_rhodes.png"],
  "volcano-pattern": ["hometheme", "[uc]tm_volcano_1", "battle_bg_square_repeat.png"],
  "volcano-title": ["hometheme", "[uc]tm_volcano_1", "battle_title_terminal_day.png"],
};

export function clockAssets(uiRoot) {
  return Object.fromEntries(Object.entries(DEFINITIONS).flatMap(([id, segments]) => {
    const filePath = path.join(uiRoot, ...segments);
    return fs.existsSync(filePath) ? [[id, filePath]] : [];
  }));
}
