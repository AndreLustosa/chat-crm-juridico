const axios = require('axios');

const API_URL = 'https://api.andrelustosaadvogados.com.br';
const API_KEY = '19a05742b587ef8e3e042d3ebe4197ae';

async function debugNameless() {
  const instanceName = 'whatsapp';
  
  console.log(`Buscando contatos da instancia: ${instanceName} no URL ${API_URL}...`);
  
  try {
    const response = await axios.post(`${API_URL}/chat/findContacts/${instanceName}`, {}, {
      headers: { 'apikey': API_KEY }
    });

    const contacts = response.data;
    console.log(`Total de contatos retornados: ${contacts.length}`);
    
    // Filtra os que não tem NENHUM nome (name, pushName, verifiedName)
    const nameless = contacts.filter(c => !c.name && !c.pushName && !c.verifiedName);
    console.log(`Contatos sem nome: ${nameless.length}`);
    
    if (nameless.length > 0) {
      console.log('Exemplo de contato sem nome:');
      console.log(JSON.stringify(nameless[0], null, 2));
    }

    // Exemplo de um com apenas remoteJid
    const onlyJid = contacts.filter(c => (c.name === undefined || c.name === null) && !c.pushName);
    console.log(`Contatos sem name e sem pushName: ${onlyJid.length}`);

  } catch (error) {
    console.error('Erro:', error.response?.data || error.message);
  }
}

debugNameless();
