'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import api from '@/lib/api';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const router = useRouter();

  useEffect(() => {
    // Auto-Login Exclusivo para Desenvolvimento Local
    if (process.env.NODE_ENV === 'development') {
      const autoLogin = async () => {
        try {
          const res = await api.post('/auth/login', {
            email: 'admin@lexcrm.com.br',
            password: 'admin123',
          });
          localStorage.setItem('token', res.data.access_token);
          router.push('/');
        } catch (e) {
          console.error('Falha no auto-login local', e);
        }
      };
      // Se não tiver token ainda, roda o script mágico
      if (!localStorage.getItem('token')) {
        autoLogin();
      }
    }
  }, [router]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
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
    <div className="flex h-screen w-full items-center justify-center bg-gray-100 dark:bg-gray-900">
      <div className="w-full max-w-md bg-white p-8 rounded-xl shadow-lg dark:bg-gray-800">
        <h1 className="text-3xl font-bold text-center text-blue-600 dark:text-blue-400 mb-6">CRM Jurídico</h1>
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
          <button type="submit" className="w-full py-2 px-4 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg shadow-md transition duration-200">
            Entrar no Painel
          </button>
        </form>
      </div>
    </div>
  );
}
