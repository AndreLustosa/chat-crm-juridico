const { PrismaClient } = require('@prisma/client');
require('dotenv').config();
const prisma = new PrismaClient();

async function main() {
  console.log('--- Checking Latest Messages ---');
  const msgs = await prisma.message.findMany({
    orderBy: { created_at: 'desc' },
    take: 5,
    include: {
      conversation: {
        include: {
          lead: true
        }
      }
    }
  });

  if (msgs.length === 0) {
    console.log('No messages found in DB.');
  } else {
    msgs.forEach(m => {
      console.log(`[${m.created_at.toISOString()}] ConvID: ${m.conversation_id} - From: ${m.conversation.lead.phone} - Text: ${m.text.substring(0, 30)}...`);
    });
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
