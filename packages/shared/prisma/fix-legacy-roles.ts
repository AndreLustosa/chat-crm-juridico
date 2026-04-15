/**
 * fix-legacy-roles.ts
 *
 * Normaliza valores legados do campo User.roles para o enum canônico usado
 * pelo sistema de permissões (AppRole em apps/web/src/lib/useRole.ts).
 *
 * CONTEXTO — Porque esse script existe:
 * O formulário de usuários antigo (apps/web/src/app/atendimento/settings/users/page.tsx)
 * salvava o nome do departamento em PT-BR como role (ex: "Advogados",
 * "Estagiário", "Atendente Comercial"). Isso quebrava os checks de permissão
 * do frontend que esperavam os enums "ADVOGADO", "ESTAGIARIO", "OPERADOR"/"COMERCIAL".
 * Resultado: usuários não-admin ficavam sem acesso a menus que deveriam ver.
 *
 * Esse script corrige em massa todos os usuários já gravados com valores
 * legados e, como caso especial, garante que a Dra. Gianny tenha tanto
 * ADVOGADO quanto OPERADOR (ela exerce as duas funções).
 *
 * Executar com:
 *   cd packages/shared && npx ts-node prisma/fix-legacy-roles.ts
 *
 * O script é idempotente — rodar duas vezes não causa dano.
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const CANONICAL_ROLES = ['ADMIN', 'ADVOGADO', 'OPERADOR', 'COMERCIAL', 'ESTAGIARIO', 'FINANCEIRO'] as const;
type CanonicalRole = typeof CANONICAL_ROLES[number];

function normalizeRole(raw: string): CanonicalRole {
  if (!raw) return 'OPERADOR';
  const upper = raw.toString().toUpperCase().trim();
  if (upper === 'ADMIN') return 'ADMIN';
  if (upper === 'ADVOGADO' || upper === 'ADVOGADOS') return 'ADVOGADO';
  if (upper === 'OPERADOR' || upper === 'OPERADORES') return 'OPERADOR';
  if (upper === 'COMERCIAL' || upper === 'ATENDENTE COMERCIAL') return 'COMERCIAL';
  if (
    upper === 'ESTAGIARIO' ||
    upper === 'ESTAGIÁRIO' ||
    upper === 'ESTAGIARIOS' ||
    upper === 'ESTAGIÁRIOS'
  )
    return 'ESTAGIARIO';
  if (upper === 'FINANCEIRO') return 'FINANCEIRO';
  return 'OPERADOR';
}

function normalizeRoles(roles: string[]): CanonicalRole[] {
  if (!roles || roles.length === 0) return ['OPERADOR'];
  const normalized = roles.map(normalizeRole);
  const seen = new Set<CanonicalRole>();
  return normalized.filter(r => (seen.has(r) ? false : (seen.add(r), true)));
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}

async function main() {
  console.log('🔎 Lendo todos os usuários do banco...');
  const users = await prisma.user.findMany({
    select: { id: true, name: true, email: true, roles: true },
    orderBy: { email: 'asc' },
  });
  console.log(`   ${users.length} usuários encontrados.\n`);

  // ── 1. Normalizar roles de todos os usuários ─────────────────
  console.log('🧹 Normalizando roles legados...');
  let changedCount = 0;
  const report: { email: string; before: string[]; after: string[] }[] = [];

  for (const u of users) {
    const before = u.roles || [];
    const after = normalizeRoles(before);
    if (!arraysEqual(before, after)) {
      await prisma.user.update({
        where: { id: u.id },
        data: { roles: after },
      });
      changedCount++;
      report.push({ email: u.email, before, after });
    }
  }

  if (changedCount === 0) {
    console.log('   ✅ Nenhum usuário precisava de normalização — todos já estão canônicos.\n');
  } else {
    console.log(`   ✅ ${changedCount} usuário(s) atualizado(s):\n`);
    report.forEach(r => {
      console.log(`      • ${r.email}`);
      console.log(`        antes: [${r.before.join(', ')}]`);
      console.log(`        depois: [${r.after.join(', ')}]`);
    });
    console.log('');
  }

  // ── 2. Caso especial: Dra. Gianny ────────────────────────────
  console.log('👩‍⚖️  Garantindo que Dra. Gianny tenha ADVOGADO + OPERADOR...');
  const gianny = await prisma.user.findFirst({
    where: {
      OR: [
        { email: { contains: 'gianny', mode: 'insensitive' } },
        { name: { contains: 'gianny', mode: 'insensitive' } },
      ],
    },
  });

  if (!gianny) {
    console.log('   ⚠️  Nenhum usuário encontrado com "gianny" no nome ou email.');
    console.log('      Ajuste manualmente via UI ou revise o filtro no script.\n');
  } else {
    const desired: CanonicalRole[] = ['ADVOGADO', 'OPERADOR'];
    const current = gianny.roles || [];
    const needsUpdate = !desired.every(r => current.includes(r));
    if (needsUpdate) {
      // Merge mantendo outros roles já existentes (ex: ADMIN)
      const merged: CanonicalRole[] = Array.from(new Set([...current.map(normalizeRole), ...desired]));
      await prisma.user.update({
        where: { id: gianny.id },
        data: { roles: merged },
      });
      console.log(`   ✅ ${gianny.email} (${gianny.name}): roles atualizados para [${merged.join(', ')}]`);
    } else {
      console.log(`   ✅ ${gianny.email} já possui ADVOGADO e OPERADOR — nada a fazer.`);
    }
  }

  console.log('\n🎉 Script finalizado com sucesso.');
}

main()
  .catch(err => {
    console.error('❌ Erro durante a execução:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
