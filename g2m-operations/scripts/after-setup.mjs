import { existsSync, copyFileSync } from "node:fs";

if (!existsSync("server/.env")) {
  copyFileSync("server/.env.example", "server/.env");
  console.log("\nCreated server/.env from the example.");
}

console.log(`
Installed.

Next, in order:

  1. Start MongoDB. Any one of these:
       docker run -d --name g2m-mongo -p 27017:27017 -v g2m-data:/data/db mongo:7
       ...or install MongoDB Community Server, which runs as a Windows service
       ...or use Atlas: put your connection string in server/.env as MONGO_URL

  2. npm run api      <- leave this terminal running

  3. npm run web      <- a SECOND terminal, leave it running too

  4. Open http://localhost:5173

Do not open web/index.html from the file system. It is a Vite source file and
will render a blank page. The dashboard is only served by 'npm run web'.
`);
