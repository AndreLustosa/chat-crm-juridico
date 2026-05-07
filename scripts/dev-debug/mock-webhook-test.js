const axios = require('axios');

const payloads = [
  'http://localhost:3001/webhooks/evolution',
  'http://localhost:3001/api/webhooks/evolution'
];

async function test() {
  for (const url of payloads) {
    console.log(`Testing URL: ${url}`);
    try {
      const resp = await axios.post(url, {
        event: 'messages.upsert',
        instanceId: 'whatsapp',
        data: {
          key: {
            remoteJid: '558299130127@s.whatsapp.net',
            fromMe: false,
            id: 'TEST_' + Date.now()
          },
          pushName: 'Tester',
          message: { conversation: 'Local test message' },
          messageType: 'conversation'
        }
      });
      console.log(`Success ${url}:`, resp.status, resp.data);
    } catch (e) {
      console.log(`Failed ${url}: ${e.message} - ${e.response?.status}`);
    }
  }
}

test();
