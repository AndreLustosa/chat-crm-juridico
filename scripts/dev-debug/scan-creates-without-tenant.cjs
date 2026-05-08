// Scanner: encontra prisma.X.create / .upsert em models que agora exigem
// tenant_id NOT NULL, mas onde o bloco `data:` ou `create:` nao menciona
// `tenant_id`. Falsos positivos sao possiveis (data spread, var name).
// Usado pra antecipar erros TS antes do CI.
//
// node scripts/dev-debug/scan-creates-without-tenant.cjs

const fs = require('fs');
const path = require('path');

const NULLABLE_MODELS = new Set([
  'user', 'lead', 'conversation', 'task', 'taskAttachment', 'inbox',
  'legalCase', 'djenIgnoredProcess', 'followupSequence', 'broadcastJob',
  'calendarEvent', 'appointmentType', 'holiday', 'caseDocument',
  'caseTranscription', 'caseDeadline', 'casePetition', 'legalTemplate',
  'caseHonorario', 'leadHonorario', 'aiChat', 'automationRule',
  'financialTransaction', 'report', 'financialTransactionAttachment',
  'financialCategory', 'monthlyGoal', 'paymentGatewayCustomer',
  'paymentGatewayCharge', 'notaFiscal', 'taxRecord', 'notification',
]);

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) out.push(full);
  }
  return out;
}

const findings = [];
for (const file of walk('apps')) {
  const text = fs.readFileSync(file, 'utf8');
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/prisma\.(\w+)\.(create|upsert)\b/);
    if (!m) continue;
    if (!NULLABLE_MODELS.has(m[1])) continue;
    const block = lines.slice(i, i + 40).join('\n');
    if (!block.includes('tenant_id')) {
      findings.push({ file, line: i + 1, model: m[1], op: m[2], snippet: lines[i].trim() });
    }
  }
}

console.log(`Encontrados ${findings.length} site(s) sem tenant_id no bloco:\n`);
for (const f of findings) {
  console.log(`  ${f.file}:${f.line}  [${f.model}.${f.op}]  ${f.snippet.slice(0, 100)}`);
}
