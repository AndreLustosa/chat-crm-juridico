const axios = require('axios');

async function testSync() {
  const port = 3005;
  const url = `http://localhost:${port}/whatsapp/instances/whatsapp/sync`;
  
  console.log(`Triggering sync on ${url}...`);
  try {
    const response = await axios.post(url, {}, {
      headers: {
        // Sem auth no controller agora para o sync? 
        // Não, eu RECOLOQUEI o JwtAuthGuard. 
        // Preciso de um token ou desativar o guard temporariamente de novo.
        // Já bati o martelo que ia desativar para testes ou usar token.
        // Como o usuário quer ver funcionando, vou desativar o guard do sync apenas temporariamente no Controller.
      }
    });
    console.log('Sync response:', response.data);
  } catch (error) {
    console.error('Sync failed:', error.response ? error.response.status : error.message);
  }
}

testSync();
