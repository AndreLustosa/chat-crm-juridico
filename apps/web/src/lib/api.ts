import axios from 'axios';

const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3005',
});

api.interceptors.request.use((config) => {
  if (typeof window !== 'undefined') {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
  }
  return config;
});

let _redirectingToLogin = false;
// Contador de 401 consecutivos para exigir múltiplas falhas antes de deslogar
let _consecutive401Count = 0;

api.interceptors.response.use(
  (response) => {
    // Qualquer resposta bem-sucedida reseta o contador de 401
    _consecutive401Count = 0;
    return response;
  },
  (error) => {
    // _silent401: true → chamadas de background (ex: inboxUpdate, polling) NUNCA causam redirect
    const isSilent = (error.config as any)?._silent401 === true;

    if (error.response?.status === 401) {
      if (isSilent) {
        // Background call: ignora silenciosamente, não incrementa contador
        return Promise.reject(error);
      }

      _consecutive401Count++;

      // Só desloga se tiver 2+ erros 401 consecutivos em ações do usuário
      // OU se já estiver redirecionando (evita flood)
      if (_consecutive401Count >= 2 && !_redirectingToLogin) {
        if (typeof window !== 'undefined') {
          _redirectingToLogin = true;
          localStorage.removeItem('token');
          window.dispatchEvent(new CustomEvent('auth:logout'));
          setTimeout(() => {
            _redirectingToLogin = false;
            _consecutive401Count = 0;
          }, 10000); // 10s cooldown — bem maior que o antigo 3s
        }
      }
    }
    return Promise.reject(error);
  }
);

export default api;
