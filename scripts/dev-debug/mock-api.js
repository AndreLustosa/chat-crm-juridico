const http = require('http');

const leads = [
  { id: '1', name: 'João Silva', phone: '+55 11 99999-1111', stage: 'NOVO', tags: ['trabalhista', 'urgente'] },
  { id: '2', name: 'Maria Souza', phone: '+55 11 98888-2222', stage: 'ATENDIMENTO', tags: ['cível', 'contrato'] },
  { id: '3', name: 'Empresa XPTO Ltda', phone: '+55 11 97777-3333', stage: 'NEGOCIANDO', tags: ['tributário'] },
  { id: '4', name: 'Carlos Oliveira', phone: '+55 11 91111-4444', stage: 'FECHADO', tags: ['família'] }
];

const conversations = [
  {
    id: 'conv1',
    lead: leads[0],
    messages: [
      { direction: 'in', type: 'text', text: 'Boa tarde, recebi uma justa causa e queria revisar meus direitos. Como funciona a consulta?', created_at: new Date(Date.now() - 3600000).toISOString(), status: 'recebido' },
      { direction: 'out', type: 'text', text: 'Olá João! Sou a assistente virtual inteligente do escritório LexCRM. Pode aguardar um instante enquanto localizo um advogado especialista?', created_at: new Date(Date.now() - 3500000).toISOString(), status: 'entregue' },
      { direction: 'in', type: 'text', text: 'Claro, aguardo. Tenho o TRCT aqui em PDF.', created_at: new Date(Date.now() - 3400000).toISOString(), status: 'recebido' }
    ],
    ai_mode: true
  }
];

const tasks = [
  { id: 't1', title: 'Analisar TRCT e propor ação - João Silva', status: 'A_FAZER', lead: leads[0] },
  { id: 't2', title: 'Agendar call de revisão contratual com Maria', status: 'A_FAZER', lead: leads[1] },
  { id: 't3', title: 'Finalizar onboarding LexCRM', status: 'CONCLUIDO', lead: null }
];

const svr = http.createServer((q, s) => {
  s.setHeader('Access-Control-Allow-Origin', '*');
  s.setHeader('Access-Control-Allow-Headers', '*');
  s.setHeader('Access-Control-Allow-Methods', '*');
  
  if (q.method === 'OPTIONS') {
    s.writeHead(204);
    s.end();
    return;
  }
  
  s.setHeader('Content-Type', 'application/json');

  if (q.url.includes('/login')) return s.end(JSON.stringify({ access_token: 'mock-token' }));
  if (q.url.includes('/leads')) return s.end(JSON.stringify(leads));
  if (q.url.includes('/tasks')) return s.end(JSON.stringify(tasks));
  if (q.url.includes('/conversations/lead')) return s.end(JSON.stringify([conversations[0]]));
  
  s.end('{}');
});

svr.listen(3001, () => console.log('Mock API running on 3001'));
