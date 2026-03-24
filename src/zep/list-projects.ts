import { ZepClient } from "./client.js";
import { ZepProjectStore } from "./projects.js";

const date = process.argv[2];
if (!date) {
  console.error("Usage: npx tsx src/zep/list-projects.ts YYYY-MM-DD");
  process.exit(1);
}

const store = new ZepProjectStore(new ZepClient());
await store.init(true, date);
console.log(store.formatProjectList());
