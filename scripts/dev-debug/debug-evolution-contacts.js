async function main() {
    let baseUrl = 'https://api.andrelustosaadvogados.com.br';
    let instance = 'whatsapp';

    if (!baseUrl.startsWith('http')) baseUrl = `https://${baseUrl}`;
    baseUrl = baseUrl.replace(/\/+$/, '');

    const paths = [
        `chat/fetchContacts/${instance}`,
        `instance/fetchInstances`,
    ];

    for (const path of paths) {
        try {
            console.log(`\n--- Testando [SEM HEADERS]: ${path} ---`);
            const response = await fetch(`${baseUrl}/${path}`);
            console.log(`Status: ${response.status}`);
            const data = await response.json();
            console.log(`Resposta: ${JSON.stringify(data).substring(0, 100)}`);
        } catch (e) {
            console.log(`Erro: ${e.message}`);
        }
    }
}

main();

main();
