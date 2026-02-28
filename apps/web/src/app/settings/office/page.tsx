'use client';

import { Building2 } from 'lucide-react';

export default function OfficeSettingsPage() {
  return (
    <div className="flex-1 flex flex-col pt-8 px-8 overflow-y-auto">
      <header className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Escritório</h1>
        <p className="text-gray-500 dark:text-gray-400 mt-1">Dados do escritório, áreas de atuação e informações gerais.</p>
      </header>
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border dark:border-gray-700 flex-1 flex flex-col items-center justify-center">
        <Building2 className="w-16 h-16 text-gray-300 dark:text-gray-600 mb-4" />
        <p className="text-gray-500 dark:text-gray-400 text-lg">Em breve</p>
        <p className="text-gray-400 dark:text-gray-500 text-sm mt-1">Configurações do escritório e tenant.</p>
      </div>
    </div>
  );
}
