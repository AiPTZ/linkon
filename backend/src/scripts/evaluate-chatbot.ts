import { readFileSync } from "fs";
import { resolve } from "path";
import { runEvaluation, type EvalCase } from "../services/eval.service";

interface SuiteFile {
  name: string;
  campaignId?: string;
  campaignName: string;
  knowledgeBaseRaw: string;
  tone: string;
  transferMessage: string;
  cases: EvalCase[];
}

async function main(): Promise<void> {
  const suitePath = process.argv[2] ?? resolve(process.cwd(), "eval/suites/exemplo.json");
  const suite = JSON.parse(readFileSync(suitePath, "utf-8")) as SuiteFile;
  console.log(`[eval] Rodando suíte "${suite.name}" (${suite.cases.length} casos)...`);
  const result = await runEvaluation(suite);
  console.log(JSON.stringify(result, null, 2));
  const releaseOk = result.hallucinationRate === 0 && result.passRate >= 1;
  console.log(releaseOk ? "[eval] APROVADO: liberar modo LLM." : "[eval] REPROVADO: manter modo RULES.");
  process.exit(releaseOk ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
