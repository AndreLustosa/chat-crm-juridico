// Atualiza a config de webhook da instancia Evolution.
// Uso: node update-webhook.js
// Le credenciais de .env (raiz do repo). Vars necessarias:
//   EVOLUTION_API_URL, EVOLUTION_API_KEY, EVOLUTION_INSTANCE, WEBHOOK_URL
const fs = require('fs');
const path = require('path');
const axios = require('axios');

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
const WEBHOOK_URL = process.env.WEBHOOK_URL;

if (!URL || !KEY || !WEBHOOK_URL) {
  console.error('Faltam EVOLUTION_API_URL, EVOLUTION_API_KEY ou WEBHOOK_URL em .env');
  process.exit(1);
}

async function update() {
  try {
    const resp = await axios({
      method: 'POST',
      url: `${URL}/webhook/set/${INSTANCE}`,
      headers: { apikey: KEY },
      data: {
        webhook: {
          url: WEBHOOK_URL,
          enabled: true,
          webhook_by_events: false,
          events: [
            'MESSAGES_UPSERT',
            'MESSAGES_UPDATE',
            'MESSAGES_DELETE',
            'CONTACTS_UPSERT',
            'CHATS_UPSERT',
            'CHATS_DELETE',
            'CONNECTION_UPDATE',
          ],
        },
      },
    });
    console.log('Update Result:', JSON.stringify(resp.data, null, 2));
  } catch (e) {
    console.log(`Failed: ${e.message} - ${e.response?.status} - ${JSON.stringify(e.response?.data)}`);
    process.exit(1);
  }
}

update();
