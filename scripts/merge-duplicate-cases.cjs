/**
 * Merge de processos (LegalCase) duplicados pelo número CNJ.
 *
 * Contexto: o cadastro em lote via OAB criou duplicatas porque o
 * /legal-cases/direct nao tinha checagem de unicidade.
 *
 * Estrategia:
 *   1) Agrupar legalCases por digits-only do case_number (case_number nulo
 *      ou < 15 digitos eh ignorado — nao confiamos em "merge" por outros campos).
 *   2) Em cada grupo, escolher o "vencedor":
 *        prioridade: honorarios + events > honorarios > events > mais dados
 *        > mais recente (updated_at).
 *   3) Reparentar todas as relacoes filhas para o vencedor.
 *   4) Apagar os perdedores. Conversations e leads dos perdedores ficam
 *      como estao (nao deletamos para evitar dano colateral).
 *
 * Uso:
 *   node scripts/merge-duplicate-cases.cjs                    # dry-run
 *   node scripts/merge-duplicate-cases.cjs --execute          # executa
 *   node scripts/merge-duplicate-cases.cjs --tenant <id>      # filtra tenant
 *   node scripts/merge-duplicate-cases.cjs --case <cnj>       # 1 grupo so
 *
 * Variaveis:
 *   DATABASE_URL  override do banco (defaults para o de producao)
 */

const { PrismaClient } = require('@prisma/client');

const args = process.argv.slice(2);
const EXECUTE = args.includes('--execute');
const tenantArg = args.find(a => a.startsWith('--tenant'));
const tenantId = tenantArg ? (tenantArg.split('=')[1] || args[args.indexOf(tenantArg) + 1]) : undefined;
const caseArg = args.find(a => a.startsWith('--case'));
const caseFilter = caseArg ? (caseArg.split('=')[1] || args[args.indexOf(caseArg) + 1]) : undefined;

const DATABASE_URL = process.env.DATABASE_URL
  || 'postgresql://crm_user:lustosa1125180124@69.62.93.186:45432/lexcrm?schema=public';

const prisma = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } });

function digitsOnly(s) {
  return (s || '').replace(/\D/g, '');
}

/** Variantes do CNJ para busca tolerante a formato (banco mistura mascarado e digits-only). */
function cnjVariants(numero) {
  const digits = digitsOnly(numero);
  const out = new Set();
  if (numero) out.add(numero);
  if (digits) out.add(digits);
  if (digits.length === 20) {
    out.add(`${digits.slice(0,7)}-${digits.slice(7,9)}.${digits.slice(9,13)}.${digits.slice(13,14)}.${digits.slice(14,16)}.${digits.slice(16,20)}`);
  }
  return Array.from(out);
}

/** Busca dados de relacionamento para escorar o caso. */
async function loadCaseStats(caseId) {
  const [
    honorariosCount,
    calendarEventsCount,
    tasksCount,
    caseEventsCount,
    documentsCount,
    deadlinesCount,
    petitionsCount,
    djenCount,
    financialCount,
    gatewayCount,
  ] = await Promise.all([
    prisma.caseHonorario.count({ where: { legal_case_id: caseId } }),
    prisma.calendarEvent.count({ where: { legal_case_id: caseId } }),
    prisma.task.count({ where: { legal_case_id: caseId } }),
    prisma.caseEvent.count({ where: { case_id: caseId } }),
    prisma.caseDocument.count({ where: { legal_case_id: caseId } }),
    prisma.caseDeadline.count({ where: { legal_case_id: caseId } }),
    prisma.casePetition.count({ where: { legal_case_id: caseId } }),
    prisma.djenPublication.count({ where: { legal_case_id: caseId } }),
    prisma.financialTransaction.count({ where: { legal_case_id: caseId } }),
    prisma.paymentGatewayCharge.count({ where: { legal_case_id: caseId } }),
  ]);
  return {
    honorariosCount,
    calendarEventsCount,
    tasksCount,
    caseEventsCount,
    documentsCount,
    deadlinesCount,
    petitionsCount,
    djenCount,
    financialCount,
    gatewayCount,
  };
}

function scoreCase(legalCase, stats) {
  // Pesos: honorarios e events sao os criterios principais do usuario.
  const hasHonorarios = stats.honorariosCount > 0 ? 1 : 0;
  const hasEvents = stats.calendarEventsCount > 0 ? 1 : 0;
  return (
    hasHonorarios * 100000 +
    hasEvents * 50000 +
    stats.honorariosCount * 100 +
    stats.calendarEventsCount * 50 +
    stats.tasksCount * 5 +
    stats.caseEventsCount * 5 +
    stats.documentsCount * 5 +
    stats.deadlinesCount * 5 +
    stats.petitionsCount * 5 +
    stats.djenCount * 2 +
    stats.financialCount * 3 +
    stats.gatewayCount * 3 +
    // recency: ate 86400 pontos para algo atualizado agora vs 0 para 1 ano atras
    Math.min(86400, Math.max(0, 86400 - (Date.now() - new Date(legalCase.updated_at).getTime()) / 1000))
  );
}

/** Reparenta children do loser -> winner. Idempotente. */
async function reparentChildren(loserId, winnerId, tx) {
  // 1) CaseEvent: tem unique em movement_hash. Se o winner ja tem o mesmo
  //    movement_hash (ex: ambos receberam mesma sincronizacao do ESAJ),
  //    deletamos a copia do loser ANTES de reparentar para nao violar unique.
  const loserEvents = await tx.caseEvent.findMany({
    where: { case_id: loserId, movement_hash: { not: null } },
    select: { id: true, movement_hash: true },
  });
  if (loserEvents.length > 0) {
    const hashes = loserEvents.map(e => e.movement_hash).filter(Boolean);
    const winnerHashes = await tx.caseEvent.findMany({
      where: { case_id: winnerId, movement_hash: { in: hashes } },
      select: { movement_hash: true },
    });
    const dupSet = new Set(winnerHashes.map(h => h.movement_hash));
    const dupIds = loserEvents.filter(e => dupSet.has(e.movement_hash)).map(e => e.id);
    if (dupIds.length > 0) {
      await tx.caseEvent.deleteMany({ where: { id: { in: dupIds } } });
    }
  }
  await tx.caseEvent.updateMany({ where: { case_id: loserId }, data: { case_id: winnerId } });

  // 2) Cascade-delete relations — devem ser reparentadas antes do delete do parent
  await tx.caseDocument.updateMany({ where: { legal_case_id: loserId }, data: { legal_case_id: winnerId } });
  await tx.caseDeadline.updateMany({ where: { legal_case_id: loserId }, data: { legal_case_id: winnerId } });
  await tx.casePetition.updateMany({ where: { legal_case_id: loserId }, data: { legal_case_id: winnerId } });
  await tx.caseHonorario.updateMany({ where: { legal_case_id: loserId }, data: { legal_case_id: winnerId } });

  // 3) SetNull relations — preservam dado mas sem vinculo se delete cascateasse;
  //    mesmo assim reparentamos para manter o vinculo apos o merge.
  await tx.task.updateMany({ where: { legal_case_id: loserId }, data: { legal_case_id: winnerId } });
  await tx.calendarEvent.updateMany({ where: { legal_case_id: loserId }, data: { legal_case_id: winnerId } });
  await tx.djenPublication.updateMany({ where: { legal_case_id: loserId }, data: { legal_case_id: winnerId } });
  await tx.financialTransaction.updateMany({ where: { legal_case_id: loserId }, data: { legal_case_id: winnerId } });
  await tx.paymentGatewayCharge.updateMany({ where: { legal_case_id: loserId }, data: { legal_case_id: winnerId } });
}

async function main() {
  console.log(`\n[merge-duplicate-cases] modo: ${EXECUTE ? 'EXECUTE' : 'DRY-RUN'}`);
  if (tenantId) console.log(`[merge-duplicate-cases] tenant filter: ${tenantId}`);
  if (caseFilter) console.log(`[merge-duplicate-cases] case filter: ${caseFilter}`);
  console.log('');

  // 1) Buscar todos os legal_cases com case_number nao-vazio (escopo tenant)
  const where = { case_number: { not: null } };
  if (tenantId) where.tenant_id = tenantId;
  if (caseFilter) {
    const variants = cnjVariants(caseFilter);
    where.case_number = { in: variants };
  }

  const cases = await prisma.legalCase.findMany({
    where,
    select: {
      id: true, case_number: true, tenant_id: true, lead_id: true, lawyer_id: true,
      created_at: true, updated_at: true, in_tracking: true, archived: true,
      lead: { select: { id: true, name: true, phone: true } },
    },
    orderBy: { created_at: 'asc' },
  });

  // 2) Agrupar por (tenant_id || '_'} + digits-only(case_number)
  const groups = new Map();
  for (const c of cases) {
    const digits = digitsOnly(c.case_number);
    if (digits.length < 15) continue; // descartar lixo
    const key = `${c.tenant_id || '_'}|${digits}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(c);
  }

  // 3) Filtrar grupos com duplicatas
  const dupGroups = Array.from(groups.entries()).filter(([, list]) => list.length > 1);

  if (dupGroups.length === 0) {
    console.log('Nenhum grupo de duplicatas encontrado.');
    return;
  }

  console.log(`Encontrados ${dupGroups.length} grupo(s) de duplicatas:\n`);

  let totalLosers = 0;
  let totalReparented = 0;

  for (const [key, list] of dupGroups) {
    // Calcular score de cada caso
    const scored = await Promise.all(list.map(async (c) => {
      const stats = await loadCaseStats(c.id);
      return { case: c, stats, score: scoreCase(c, stats) };
    }));
    scored.sort((a, b) => b.score - a.score);
    const winner = scored[0];
    const losers = scored.slice(1);

    const cnj = list[0].case_number;
    console.log(`──────────────────────────────────────────────────`);
    console.log(`CNJ: ${cnj}  (tenant=${list[0].tenant_id || '_'})`);
    console.log(`  ${list.length} caso(s):`);
    for (const s of scored) {
      const flags = [];
      if (s.stats.honorariosCount > 0) flags.push(`hon=${s.stats.honorariosCount}`);
      if (s.stats.calendarEventsCount > 0) flags.push(`cal=${s.stats.calendarEventsCount}`);
      if (s.stats.tasksCount > 0) flags.push(`tasks=${s.stats.tasksCount}`);
      if (s.stats.djenCount > 0) flags.push(`djen=${s.stats.djenCount}`);
      if (s.stats.documentsCount > 0) flags.push(`docs=${s.stats.documentsCount}`);
      if (s.stats.deadlinesCount > 0) flags.push(`prazo=${s.stats.deadlinesCount}`);
      if (s.stats.petitionsCount > 0) flags.push(`pet=${s.stats.petitionsCount}`);
      if (s.stats.financialCount > 0) flags.push(`fin=${s.stats.financialCount}`);
      const role = s === winner ? 'KEEP   ' : 'MERGE→ ';
      console.log(
        `    ${role} id=${s.case.id}  lead=${s.case.lead?.name || '-'}  ` +
        `score=${Math.round(s.score)}  ${flags.join(' ')}  ` +
        `created=${new Date(s.case.created_at).toISOString().slice(0,10)}`
      );
    }

    if (!EXECUTE) {
      totalLosers += losers.length;
      continue;
    }

    // Executar merge transacional para este grupo
    try {
      await prisma.$transaction(async (tx) => {
        for (const loser of losers) {
          await reparentChildren(loser.case.id, winner.case.id, tx);
          await tx.legalCase.delete({ where: { id: loser.case.id } });
          totalLosers++;
          totalReparented += 1;
        }
      }, { timeout: 30000 });
      console.log(`  ✓ merge concluido (${losers.length} duplicata(s) removida(s))`);
    } catch (err) {
      console.error(`  ✗ falha no merge: ${err.message}`);
    }
  }

  console.log(`\n──────────────────────────────────────────────────`);
  if (EXECUTE) {
    console.log(`✓ Concluido: ${totalReparented} grupo(s), ${totalLosers} duplicata(s) removida(s).`);
  } else {
    console.log(`Plano: ${dupGroups.length} grupo(s), ${totalLosers} duplicata(s) seriam removida(s).`);
    console.log(`Para executar: node scripts/merge-duplicate-cases.cjs --execute`);
  }
}

main()
  .catch((e) => { console.error('[merge-duplicate-cases]', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
