import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildContactsXlsx } from "../src/services/network.service";
import { prisma } from "../src/lib/prisma";

async function main(): Promise<void> {
  const out = resolve(process.argv[2] ?? "/workspace/backup01.xlsx");
  const { buffer } = await buildContactsXlsx(null, []);
  writeFileSync(out, buffer);
  console.log(`Contatos exportados para ${out} (${buffer.length} bytes)`);
  await prisma.$disconnect();
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
