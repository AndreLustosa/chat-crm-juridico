const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

async function check() {
  const apiUrl = "api.andrelustosaadvogados.com.br";
  const apiKey = "19a05742b587ef8e3e042d3ebe4197ae";
  
  // Normalização manual para teste
  let normalized = apiUrl.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(normalized)) {
    normalized = `https://${normalized}`;
  }
  
  const url = `${normalized}/instance/fetchInstances`;
  
  console.log(`Testando URL: ${url}`);
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        apikey: apiKey
      }
    });
    
    console.log(`Status HTTP: ${res.status}`);
    const data = await res.json();
    console.log('Resposta:', JSON.stringify(data, null, 2).substring(0, 1000));
  } catch (e) {
    console.error('Erro no teste:', e.message);
  }
}

check();
