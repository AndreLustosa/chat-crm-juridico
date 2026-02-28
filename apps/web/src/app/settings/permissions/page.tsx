'use client';

import { Shield } from 'lucide-react';

export default function PermissionsSettingsPage() {
  return (
    <div className="flex-1 flex flex-col pt-8 px-8 overflow-y-auto">
      <header className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Permissões</h1>
        <p className="text-gray-500 dark:text-gray-400 mt-1">Gerencie permissões e controle de acesso por perfil.</p>
      </header>
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border dark:border-gray-700 flex-1 flex flex-col items-center justify-center">
        <Shield className="w-16 h-16 text-gray-300 dark:text-gray-600 mb-4" />
        <p className="text-gray-500 dark:text-gray-400 text-lg">Em breve</p>
        <p className="text-gray-400 dark:text-gray-500 text-sm mt-1">Controle granular de acesso por perfil de usuário.</p>
      </div>
    </div>
  );
}
