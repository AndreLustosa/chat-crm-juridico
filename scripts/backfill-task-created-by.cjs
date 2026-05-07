/**
 * Backfill de Task.created_by_id pra tasks antigas que ficaram com NULL.
 *
 * Contexto: antes do commit f15156b, o campo created_by_id nao era
 * persistido. Tasks daquela epoca nao aparecem no painel "Diligencias
 * Delegadas" do advogado (filtra por created_by_id).
 *
 * Heuristicas (em ordem de confianca):
 *   1) Se a Task tem legal_case_id, usa o lawyer_id do legal_case
 *      (advogado responsavel pelo processo eh quem mais provavelmente
 *      delegou).
 *   2) Se nao tem legal_case mas tem assigned_user_id, e existe pelo
 *      menos 1 comentario de advogado naquela task ANTES da criacao
 *      do comentario do estagiario, usa o autor do primeiro comment
 *      de advogado.
 *   3) Caso contrario, deixa NULL (nao temos sinal confiavel).
 *
 * Uso:
 *   node scripts/backfill-task-created-by.cjs           # dry-run
 *   node scripts/backfill-task-created-by.cjs --execute # aplica
 */

const { PrismaClient } = require('@prisma/client');

const args = process.argv.slice(2);
const EXECUTE = args.includes('--execute');

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL nao definida. Exporte no shell ou rode com .env carregado.');
  process.exit(1);
}

const prisma = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } });

async function main() {
  console.log(`[backfill-task-created-by] modo: ${EXECUTE ? 'EXECUTE' : 'DRY-RUN'}\n`);

  // Tasks orfas: created_by_id NULL, com pelo menos algum sinal pra inferir
  const orphans = await prisma.task.findMany({
    where: { created_by_id: null },
    select: {
      id: true, title: true, legal_case_id: true, assigned_user_id: true,
      created_at: true,
      legal_case: { select: { lawyer_id: true } },
    },
    orderBy: { created_at: 'desc' },
  });

  console.log(`Encontradas ${orphans.length} tasks com created_by_id NULL.`);
  if (orphans.length === 0) return;

  let strategy1 = 0;
  let strategy2 = 0;
  let unresolved = 0;
  const updates = [];

  for (const t of orphans) {
    // 1) Lawyer do legal_case
    if (t.legal_case?.lawyer_id) {
      updates.push({ id: t.id, created_by_id: t.legal_case.lawyer_id, source: 'legal_case.lawyer' });
      strategy1++;
      continue;
    }

    // 2) Primeiro comentario de advogado/admin antes de qualquer comentario
    //    do assigned_user (estagiario)
    if (t.assigned_user_id) {
      const comments = await prisma.taskComment.findMany({
        where: { task_id: t.id },
        orderBy: { created_at: 'asc' },
        include: { user: { select: { id: true, roles: true } } },
        take: 10,
      });
      const lawyerComment = comments.find(c =>
        c.user_id !== t.assigned_user_id &&
        Array.isArray(c.user?.roles) &&
        c.user.roles.some((r) => ['ADVOGADO', 'Advogados', 'ADMIN'].includes(r)),
      );
      if (lawyerComment) {
        updates.push({ id: t.id, created_by_id: lawyerComment.user_id, source: 'first_lawyer_comment' });
        strategy2++;
        continue;
      }
    }

    unresolved++;
  }

  console.log(`Plano:`);
  console.log(`  - ${strategy1} tasks via lawyer do processo`);
  console.log(`  - ${strategy2} tasks via primeiro comentario de advogado`);
  console.log(`  - ${unresolved} tasks sem sinal confiavel (continuam NULL)\n`);

  if (!EXECUTE) {
    console.log('Pra aplicar: node scripts/backfill-task-created-by.cjs --execute');
    return;
  }

  // Aplica em batch — agrupa por created_by_id pra usar updateMany
  const byUser = new Map();
  for (const u of updates) {
    if (!byUser.has(u.created_by_id)) byUser.set(u.created_by_id, []);
    byUser.get(u.created_by_id).push(u.id);
  }

  let totalUpdated = 0;
  for (const [userId, ids] of byUser) {
    const result = await prisma.task.updateMany({
      where: { id: { in: ids }, created_by_id: null },
      data: { created_by_id: userId },
    });
    totalUpdated += result.count;
    console.log(`  ✓ ${result.count} tasks → created_by=${userId}`);
  }

  console.log(`\n✓ Concluido: ${totalUpdated} tasks atualizadas.`);
}

main()
  .catch(e => { console.error('[backfill]', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
