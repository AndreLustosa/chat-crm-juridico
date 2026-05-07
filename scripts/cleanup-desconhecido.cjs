const { PrismaClient } = require('@prisma/client');
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL nao definida. Exporte no shell ou rode com .env carregado.');
  process.exit(1);
}
const prisma = new PrismaClient();

async function main() {
  // Check stats before deleting
  const leads = await prisma.$queryRaw`
    SELECT l.id, l.phone,
           COUNT(DISTINCT c.id)::int AS convs,
           COUNT(m.id)::int AS msgs
    FROM "Lead" l
    LEFT JOIN "Conversation" c ON c.lead_id = l.id
    LEFT JOIN "Message" m ON m.conversation_id = c.id
    WHERE l.name = 'Desconhecido'
    GROUP BY l.id, l.phone
    ORDER BY 4 DESC
  `;

  console.log('Leads Desconhecido encontrados:');
  console.table(leads);

  const withMsgs = leads.filter(l => l.msgs > 0);
  if (withMsgs.length > 0) {
    console.log('\nLEADS COM MENSAGENS (não serão apagados):');
    console.table(withMsgs);
  }

  // Delete only leads with no messages (no conversations with messages)
  const safeToDelete = leads.filter(l => l.msgs == 0).map(l => l.id);
  console.log(`\nApagando ${safeToDelete.length} leads sem mensagens...`);

  // Delete conversations (empty) belonging to those leads first
  const delConvs = await prisma.conversation.deleteMany({
    where: { lead_id: { in: safeToDelete } },
  });
  console.log(`  └─ ${delConvs.count} conversas vazias apagadas.`);

  const deleted = await prisma.lead.deleteMany({
    where: { id: { in: safeToDelete } },
  });

  console.log(`✓ ${deleted.count} leads apagados.`);
}

main()
  .catch(e => { console.error(e.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
