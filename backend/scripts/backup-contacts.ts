import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildContactsXlsx } from "../src/services/network.service";

async function main(): Promise<void> {
  const out = resolve(process.argv[2] ?? "/workspace/backup01.xlsx");
  const { buffer } = await buildContactsXlsx(null, []);
  writeFileSync(out, buffer);
  console.log(`Contatos exportados para ${out} (${buffer.length} bytes)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
