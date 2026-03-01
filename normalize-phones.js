const { PrismaClient } = require('@crm/shared');
const prisma = new PrismaClient();

function normalizeBrazilianPhone(phone) {
  // Remove tudo que não for dígito
  let digits = phone.replace(/\D/g, '');
  if (!digits.startsWith('55')) return digits;

  // Mobile com 8 digitos (legado): 55 + DD + 8 digitos = 12 digitos
  if (digits.length === 12) {
    const ddd = digits.substring(2, 4);
    const number = digits.substring(4);
    // Se o numero começa com [6, 7, 8, 9], é um celular que precisa de nono dígito
    if (['6', '7', '8', '9'].includes(number[0])) {
      return `55${ddd}9${number}`;
    }
  }
  return digits;
}

async function normalize() {
  console.log('Iniciando normalizacao de telefones (9-digito)...');
  
  try {
    const leads = await prisma.lead.findMany({
      select: {
        id: true,
        phone: true,
        name: true
      }
    });

    console.log(`Verificando ${leads.length} leads...`);
    let updated = 0;
    let conflicts = 0;

    for (const lead of leads) {
      if (!lead.phone) continue;

      const normalized = normalizeBrazilianPhone(lead.phone);

      if (normalized !== lead.phone) {
        try {
          // Tenta atualizar
          await prisma.lead.update({
            where: { id: lead.id },
            data: { phone: normalized }
          });
          console.log(`[OK] ${lead.name}: ${lead.phone} -> ${normalized}`);
          updated++;
        } catch (err) {
          if (err.code === 'P2002') {
            console.log(`[!] Conflito: ${normalized} ja existe. Removendo duplicata ${lead.name}...`);
            // Se ja existe o numero certo, deletamos a duplicata "errada"
            // Antes de deletar, temos que limpar conversas
            await prisma.conversation.deleteMany({ where: { lead_id: lead.id } });
            await prisma.lead.delete({ where: { id: lead.id } });
            conflicts++;
          } else {
            console.error(`[ERR] Falha ao atualizar ${lead.name}:`, err.message);
          }
        }
      }
    }

    console.log(`\nFinalizado!`);
    console.log(`- Contatos atualizados: ${updated}`);
    console.log(`- Conflitos resolvidos (removidos): ${conflicts}`);
  } catch (error) {
    console.error('Erro geral:', error);
  } finally {
    await prisma.$disconnect();
  }
}

normalize();
