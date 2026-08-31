# Segurança do LinkON

Tratamento dos achados do relatório de segurança **GitGuard** (Semgrep + Trivy) sobre o commit
`cb3f0ed` (branch `master`). O relatório apontou **13 findings: 4 HIGH, 9 MEDIUM**. Este documento
registra o que foi corrigido, como foi corrigido e quais findings foram avaliados como não aplicáveis
ou aceitos (com justificativa).

> Para reproduzir: rode a varredura do GitGuard no branch `master` e compare com a lista abaixo.

---

## 1. Corrigido (dependências)

As correções de dependência seguem a regra **um upgrade por pacote** (para a versão recomendada ou mais
recente disponível), cobrindo todos os CVEs do pacote de uma vez.

### 1.1. `brace-expansion` (HIGH) → `5.0.9`

- **Cadeia**: `exceljs@4.4.0` → `archiver@5.3.2` → (`glob@7.2.3` → `minimatch@3.1.5` e
  `readdir-glob@1.1.3` → `minimatch@5.1.9`) → `brace-expansion@1.1.18`/`2.1.4`.
- **CVE**: DoS por padrões de brace maliciosos (afeta as linhas 1.x–5.0.7). A correção real só existe
  na série 5.0.8+, que **quebrou a API** (`braceExpand` foi renomeado para `expand`) — por isso não é
  possível apenas atualizar o pacote dos consumidores (minimatch).
- **Fix aplicado**: `overrides: { "brace-expansion": "5.0.9" }` no `package.json` raiz. O
  `minimatch` só chama `braceExpand` quando o padrão contém `{`; no fluxo do LinkON o archiver nunca
  executa `glob()`/`directory()` (o exceljs usa `append()`/`file()` com nomes explícitos), portanto a
  troca de API é inócua no runtime.
- **Validação**: suíte de testes (175/175), typecheck e smoke test real de exportação XLSX via
  `WorkbookWriter` (caminho do archiver) gerando ZIP válido — passaram.

### 1.2. `uuid` (MEDIUM) → `14.0.2`

- **Cadeia**: `exceljs@4.4.0` (^8.3.0) e `node-cron@3.0.3` (^8.3.2) → `uuid@8.3.2`.
- **Fix aplicado**: `overrides: { "uuid": "14.0.2" }` no `package.json` raiz. Ambos os consumidores
  usam `require("uuid").v4()` — compatível e validado em runtime.
- **Validação**: testes + smoke de geração de UUID via `require("uuid").v4()` — OK.

### 1.3. `react-router-dom` (MEDIUM, 2 CVEs) → `7.18.3`

- **Cadeia**: `react-router-dom@6.30.6` (frontend) → `react-router@6.30.6`. As CVEs (open redirect e
  constructor injection em `deserializeErrors`) **não têm correção na linha v6** — o último 6.x
  (`6.30.6`) ainda é vulnerável.
- **Fix aplicado**: upgrade do frontend para `react-router-dom@^7.18.3` (instala `react-router@7.18.3`).
  O v7 mantém como re-export do `react-router` todas as APIs usadas pelo app (`BrowserRouter`, `Routes`,
  `Route`, `Link`, `NavLink`, `Navigate`, `Outlet`, `useNavigate`, `useParams`, `useSearchParams`) — sem
  `json`/`defer`/loaders, então a migração foi segura.
- **Validação**: `tsc --noEmit` limpo, `vite build` OK, dev server servindo e módulos compilando via
  preview.

---

## 2. Corrigido (Semgrep, código)

### 2.1. `gcm-no-tag-length` (HIGH) — `backend/src/utils/crypto.ts`

- **Problema**: AES-256-GCM sem tamanho de tag explícito.
- **Fix**: `createCipheriv`/`createDecipheriv` agora recebem `{ authTagLength: 16 }` explícito (GCM).
- **Validação**: roundtrip encrypt/decrypt em smoke test (payload válido e payload inválido rejeitado).

### 2.2. `node_insecure_random_generator` (MEDIUM) — `backend/src/utils/time.ts`

- **Problema**: `Math.random()` em `randomInt`/`randomDelayMs`.
- **Fix**: `crypto.randomInt` preservando as assinaturas (`randomInt(min, max)` inclusivo;
  `randomDelayMs` usa `crypto.randomInt(0, 60_000)` para os segundos extras). Os testes existentes só
  checam limites, então não precisaram de mock.
- **Validação**: `time.test.ts` passando; nenhuma mudança de contrato.

---

## 3. Avaliados como não aplicáveis / aceitos

### 3.1. `express_xss` (HIGH, 2 ocorrências) — falso-positivo

- **Locais**: `backend/src/routes/extractions.routes.ts` (`GET /api/extractions/:id/export-xlsx`) e
  `backend/src/routes/campaigns.routes.ts` (`GET /api/campaigns/:id/export-xlsx`).
- **Análise**: `res.send(buffer)` envia um **binário XLSX**, com
  `Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` e
  `Content-Disposition: attachment` definidos **antes** do `send`. Não há interpretação como HTML, logo
  não há vetor de XSS. `filename` é gerado no servidor (`getScopedCampaign`/`exportExtractionXlsx`).
- **Decisão**: nenhuma mudança de código. Documentado como falso-positivo.

### 3.2. `missing-integrity` (MEDIUM) — não aplicável

- **Local**: `frontend/index.html`.
- **Análise**: não há CDN externa. Favicon é `data:` URI inline e o único script é `/src/main.tsx`
  (bundle servido pelo próprio Vite no mesmo host). SRI (`integrity`/`crossorigin`) protege contra CDN
  comprometida, o que não se aplica aqui.
- **Decisão**: nenhuma mudança. Se no futuro houver import de CDN externa, adicionar `integrity`.

### 3.3. `detect-non-literal-regexp` (MEDIUM) — aceito (feature legítima)

- **Local**: `backend/src/services/chatbot.service.ts` (`ruleMatches`, caso `matchType: "regex"`).
- **Análise**: `new RegExp(rule.pattern, "i")` é a implementação da feature "regra por regex" do bot,
  configurada pelo próprio dono da conta (fonte confiável, via UI). Já está envolvido em `try/catch`
  (padrão inválido → `false`). A mensagem processada tem tamanho limitado (~1000 chars), limitando o
  impacto de um padrão ReDoS.
- **Decisão**: aceito sem mudança de comportamento.

---

## 4. Notas de operação

- Os `overrides` ficam no `package.json` raiz e exigem **install limpo** para aplicar de fato: mova
  `node_modules` e `package-lock.json` (ou rode em um checkout limpo) antes de `npm install`. Um
  `npm install` sobre uma árvore já existente pode manter os pacotes antigos (marcados como
  `overridden` no `npm ls`).
- Depois de `npm ci`/install limpo, regenere o Prisma client: `npm run db:generate -w @linkon/backend`
  (o `node_modules` recém-criado não contém o client gerado).
- Reinicie API e workers após essas mudanças (`tsx` não recarrega módulos já carregados).
