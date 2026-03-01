const axios = require('axios');

const API_URL = 'https://api.andrelustosaadvogados.com.br';
const API_KEY = '19a05742b587ef8e3e042d3ebe4197ae';

async function listInstances() {
  console.log(`Linsting instances in ${API_URL}...`);
  try {
    const response = await axios.get(`${API_URL}/instance/fetchInstances`, {
      headers: { 'apikey': API_KEY }
    });
    console.log('Instances found:');
    console.log(JSON.stringify(response.data, null, 2));
  } catch (error) {
    console.error('Error:', error.response?.data || error.message);
  }
}

listInstances();
