const { PrismaClient } = require('./node_modules/.prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('--- Rescuing Orphan Conversations ---');
  
  // 1. Get the commercial inbox/tenant
  const inbox = await prisma.inbox.findFirst({
    where: { name: 'Comercial' }
  });
  
  if (!inbox) {
    console.error('Comercial inbox not found. Cannot rescue.');
    return;
  }

  // 2. Update leads with null tenant
  const updatedLeads = await prisma.lead.updateMany({
    where: { tenant_id: null },
    data: { tenant_id: inbox.tenant_id }
  });
  console.log(`Rescued ${updatedLeads.count} leads.`);

  // 3. Update conversations with null tenant
  const updatedConvos = await prisma.conversation.updateMany({
    where: { tenant_id: null },
    data: { 
      tenant_id: inbox.tenant_id,
      inbox_id: inbox.id,
      instance_name: 'whatsapp' // Fallback to 'whatsapp' which is the common name
    }
  });
  console.log(`Rescued ${updatedConvos.count} conversations.`);

  console.log('--- Rescue Finished ---');
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });
