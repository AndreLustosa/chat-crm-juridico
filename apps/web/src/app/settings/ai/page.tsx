'use client';

import { Bot } from 'lucide-react';

export default function AiSettingsPage() {
  return (
    <div className="flex-1 flex flex-col pt-8 px-8 overflow-y-auto">
      <header className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Ajustes IA</h1>
        <p className="text-gray-500 dark:text-gray-400 mt-1">Configure o comportamento da inteligência artificial no atendimento.</p>
      </header>
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border dark:border-gray-700 flex-1 flex flex-col items-center justify-center">
        <Bot className="w-16 h-16 text-gray-300 dark:text-gray-600 mb-4" />
        <p className="text-gray-500 dark:text-gray-400 text-lg">Em breve</p>
        <p className="text-gray-400 dark:text-gray-500 text-sm mt-1">Configurações de prompts, skills e políticas da IA.</p>
      </div>
    </div>
  );
}
