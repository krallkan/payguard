// Forces demo mode (works on Windows and Unix shells) and starts a target:
//   npm run demo          → web console on http://localhost:3000
//   npm run demo:attack   → attack demo in the terminal
process.env.DEMO = "1"; // set before dotenv loads, so a .env with DEMO=0 cannot override it
const target = process.argv[2] ?? "web";
if (target === "attack") await import("./attack.js");
else await import("../packages/web/src/server.js");
