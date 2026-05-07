const { PrismaClient } = require('./node_modules/.prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('--- Starting Database Cleanup ---');
  
  // Wipe in order of dependencies
  const media = await prisma.media.deleteMany({});
  console.log(`Deleted ${media.count} media records.`);

  const messages = await prisma.message.deleteMany({});
  console.log(`Deleted ${messages.count} messages.`);

  const tasks = await prisma.task.deleteMany({});
  console.log(`Deleted ${tasks.count} tasks.`);

  const conversations = await prisma.conversation.deleteMany({});
  console.log(`Deleted ${conversations.count} conversations.`);

  const aiMemory = await prisma.aiMemory.deleteMany({});
  console.log(`Deleted ${aiMemory.count} AI memory records.`);

  const leads = await prisma.lead.deleteMany({});
  console.log(`Deleted ${leads.count} leads (contacts).`);

  console.log('--- Cleanup Finished ---');
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });
