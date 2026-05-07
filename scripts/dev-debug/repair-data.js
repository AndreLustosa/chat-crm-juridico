// Recupera ultima mensagem de cada chat da Evolution para o BD local.
// Uso: node repair-data.js
// Le credenciais de .env (raiz do repo). Vars necessarias:
//   EVOLUTION_API_URL, EVOLUTION_API_KEY, EVOLUTION_INSTANCE,
//   REPAIR_TENANT_ID (uuid do tenant para preencher Conversation.tenant_id NULL),
//   DATABASE_URL (lido pelo Prisma client)
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { PrismaClient } = require('./node_modules/.prisma/client');

function loadEnv() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf-8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/i);
    if (!m) continue;
    const k = m[1];
    if (process.env[k]) continue;
    process.env[k] = m[2].replace(/^['"]|['"]$/g, '');
  }
}
loadEnv();

const URL = process.env.EVOLUTION_API_URL;
const KEY = process.env.EVOLUTION_API_KEY;
const INSTANCE = process.env.EVOLUTION_INSTANCE || 'whatsapp';
const TENANT_ID = process.env.REPAIR_TENANT_ID;

if (!URL || !KEY || !TENANT_ID) {
  console.error('Faltam EVOLUTION_API_URL, EVOLUTION_API_KEY ou REPAIR_TENANT_ID em .env');
  process.exit(1);
}

const prisma = new PrismaClient();

async function main() {
  console.log('--- Fixing Tenant IDs ---');
  const convFix = await prisma.conversation.updateMany({
    where: { tenant_id: null },
    data: { tenant_id: TENANT_ID },
  });
  console.log(`Updated ${convFix.count} conversations with tenant_id`);

  console.log('--- Fetching Chats for Message Injection ---');
  const resp = await axios({
    method: 'POST',
    url: `${URL}/chat/findChats/${INSTANCE}`,
    headers: { apikey: KEY, 'Content-Type': 'application/json' },
    data: { where: {}, limit: 1000 },
  });
  const chats = resp.data;
  console.log(`Found ${chats.length} chats in Evolution.`);

  let msgCount = 0;
  for (const chat of chats) {
    if (!chat.lastMessage) continue;
    const lm = chat.lastMessage;
    const msgId = lm.key?.id || lm.id;
    const msgText =
      lm.message?.conversation ||
      lm.message?.extendedTextMessage?.text ||
      lm.message?.imageMessage?.caption ||
      (lm.messageType !== 'conversation' ? `[${lm.messageType}]` : '');
    if (!msgId || !msgText) continue;

    let conv = await prisma.conversation.findFirst({
      where: { external_id: chat.remoteJid, instance_name: INSTANCE },
    });
    if (!conv && chat.remoteJidAlt) {
      conv = await prisma.conversation.findFirst({
        where: { external_id: chat.remoteJidAlt, instance_name: INSTANCE },
      });
    }
    if (!conv) continue;

    await prisma.message.upsert({
      where: { external_message_id: msgId },
      update: { status: lm.status || 'recebido' },
      create: {
        conversation_id: conv.id,
        direction: lm.key?.fromMe ? 'out' : 'in',
        type: 'text',
        text: msgText,
        external_message_id: msgId,
        status: lm.status || 'recebido',
        created_at: lm.messageTimestamp ? new Date(lm.messageTimestamp * 1000) : new Date(),
      },
    });
    await prisma.conversation.update({
      where: { id: conv.id },
      data: {
        last_message_at: lm.messageTimestamp ? new Date(lm.messageTimestamp * 1000) : new Date(),
      },
    });
    msgCount++;
  }
  console.log(`Injected ${msgCount} last messages into DB.`);
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });
