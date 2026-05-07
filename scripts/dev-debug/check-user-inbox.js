const { PrismaClient } = require('./node_modules/.prisma/client');
const prisma = new PrismaClient();

async function main() {
  const user = await prisma.user.findFirst({
    where: { email: 'andrelustosa.adv@hotmail.com' },
    include: { inboxes: true }
  });
  console.log('User and Inboxes:', JSON.stringify(user, null, 2));
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });
