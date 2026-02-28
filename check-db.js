const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient({
  datasources: {
    db: {
      url: "postgresql://crm_user:lustosa1125180124@69.62.93.186:45432/lexcrm?schema=public"
    }
  }
});

async function main() {
  const settings = await prisma.globalSetting.findMany();
  console.log(JSON.stringify(settings, null, 2));
  await prisma.$disconnect();
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
