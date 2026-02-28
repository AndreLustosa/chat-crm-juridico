'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import api from '@/lib/api';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const router = useRouter();

  useEffect(() => {
    // Auto-Login Exclusivo para Desenvolvimento Local (Bypass de DB)
    if (process.env.NODE_ENV === 'development') {
      const autoLogin = async () => {
        localStorage.setItem('token', 'mock-dev-token');
        router.push('/');
      };
      if (!localStorage.getItem('token') || localStorage.getItem('token') !== 'mock-dev-token') {
        autoLogin();
      }
    }
  }, [router]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Bypass forçado se usuário clicar "Entrar" rodando local
    if (process.env.NODE_ENV === 'development') {
      localStorage.setItem('token', 'mock-dev-token');
      router.push('/');
      return;
    }

    try {
      const res = await api.post('/auth/login', {
        email,
        password,
      });
      localStorage.setItem('token', res.data.access_token);
      router.push('/');
    } catch (err) {
      alert('Credenciais inválidas. Verifique usuário e senha.');
    }
  };

  return (
    <div className="flex h-screen w-full items-center justify-center overflow-hidden">
      <div className="w-full max-w-md border dark:border-gray-800 p-8 rounded-xl shadow-lg">
        <h1 className="text-3xl font-bold text-center bg-clip-text text-transparent bg-gradient-to-r from-blue-600 to-indigo-500 mb-6">CRM Jurídico</h1>
        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Email</label>
            <input 
              type="email" 
              required
              className="mt-1 w-full px-4 py-2 border rounded-lg focus:ring-blue-500 focus:border-blue-500 text-gray-900" 
              value={email}
              onChange={e => setEmail(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Senha</label>
            <input 
              type="password" 
              required
              className="mt-1 w-full px-4 py-2 border rounded-lg focus:ring-blue-500 focus:border-blue-500 text-gray-900" 
              value={password}
              onChange={e => setPassword(e.target.value)}
            />
          </div>
          <button type="submit" className="w-full py-2 px-4 btn-primary text-white font-semibold rounded-lg shadow-md transition duration-200">
            Entrar no Painel (Bypass Local)
          </button>
        </form>
      </div>
    </div>
  );
}
