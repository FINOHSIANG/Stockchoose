import fs from "fs";
const t = fs.readFileSync("src/App.tsx", "utf8");
const lines = t.split(/\r?\n/);
// Find MainSection type and PaperTradeState references
lines.forEach((l, i) => {
  const s = l.trim();
  if (/type MainSection|MainSection =/.test(s)) console.log(i + 1, s.slice(0, 120));
});
