const { PrismaClient } = require('./node_modules/.prisma/client');
const prisma = new PrismaClient();

async function main() {
  const settings = await prisma.globalSetting.findMany();
  console.log(JSON.stringify(settings, null, 2));
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
