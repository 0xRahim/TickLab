import { BrowserWindow } from "electrobun/main";
import { startServer } from "./server";

// Backend first (API + static frontend), then the app window on top.
// For headless/dev use: `bun src/bun/server.ts` (no Electrobun needed).
const { url } = startServer();

const mainWindow = new BrowserWindow({
  title: "TickLab",
  url,
  frame: { width: 1400, height: 900, x: 200, y: 100 },
});

console.log(`[ticklab] window → ${url}`);
export { mainWindow };
