'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Send, Paperclip, Bot, User as UserIcon } from 'lucide-react';
import axios from 'axios';
import { io, Socket } from 'socket.io-client';

export default function ChatPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const [messages, setMessages] = useState<any[]>([]);
  const [text, setText] = useState('');
  const [lead, setLead] = useState<any>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) {
      router.push('/login');
      return;
    }

    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

    // 1. Fetch convo info & messages
    const fetchData = async () => {
       try {
         // Assuming params.id is leadId down from the dashboard, 
         // we fetch the conversation for this lead
         const convoRes = await axios.get(`${apiUrl}/conversations/lead/${params.id}`, {
           headers: { Authorization: `Bearer ${token}` }
         });
         if (convoRes.data && convoRes.data.length > 0) {
           const convo = convoRes.data[0];
           setLead(convo.lead);
           setMessages(convo.messages || []);
           
           // 2. Setup Socket.IO
           socketRef.current = io(apiUrl);
           socketRef.current.emit('join_conversation', convo.id);
           socketRef.current.on('newMessage', (msg: any) => {
             setMessages(prev => [...prev, msg]);
           });
         }
       } catch (e) {
         console.error(e);
       }
    };
    
    fetchData();

    return () => {
      socketRef.current?.disconnect();
    };
  }, [params.id, router]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;

    try {
      const token = localStorage.getItem('token');
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
      
      const convoRes = await axios.get(`${apiUrl}/conversations/lead/${params.id}`, { headers: { Authorization: `Bearer ${token}` } });
      const convoId = convoRes.data[0]?.id;

      if (convoId) {
        await axios.post(`${apiUrl}/messages/send`, {
          conversationId: convoId,
          text
        }, { headers: { Authorization: `Bearer ${token}` } });
        
        // Optimistic UI update or rely on socket
        setText('');
      }
    } catch (e) {
      alert('Falha ao enviar mensagem');
    }
  };

  return (
    <div className="flex flex-col h-screen bg-white dark:bg-gray-900">
      {/* Header */}
      <header className="flex items-center px-6 py-4 border-b dark:border-gray-800 bg-gray-50 dark:bg-gray-900">
        <button onClick={() => router.push('/')} className="mr-4 text-gray-500 hover:text-gray-900 dark:hover:text-white transition-colors">
          <ArrowLeft className="w-6 h-6" />
        </button>
        <div className="flex items-center flex-1">
          <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-900 flex items-center justify-center text-blue-600 dark:text-blue-200 font-bold mr-4">
            {lead?.name?.charAt(0) || lead?.phone?.charAt(0) || <UserIcon />}
          </div>
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">{lead?.name || lead?.phone || 'Carregando...'}</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">WhatsApp • Em atendimento</p>
          </div>
        </div>
        <div className="flex space-x-2">
           <button className="px-4 py-2 text-sm font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 dark:bg-blue-900/30 dark:hover:bg-blue-900/50 dark:text-blue-300 rounded-lg transition-colors flex items-center">
             <Bot className="w-4 h-4 mr-2" />
             IA Ativa
           </button>
        </div>
      </header>

      {/* Messages Area */}
      <main className="flex-1 overflow-y-auto p-6 bg-slate-50 dark:bg-black/20" ref={scrollRef}>
        <div className="space-y-6 max-w-4xl mx-auto">
          {messages.map((msg, idx) => {
            const isOut = msg.direction === 'out';
            return (
               <div key={idx} className={`flex ${isOut ? 'justify-end' : 'justify-start'}`}>
                 <div className={`max-w-[85%] rounded-2xl px-4 py-3 ${isOut ? 'bg-gradient-to-br from-blue-600 to-indigo-500 text-white rounded-br-sm shadow-md' : 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-bl-sm shadow-sm border dark:border-white/5'}`}>
                   {msg.type === 'text' || !msg.type ? (
                     <p className="whitespace-pre-wrap text-[15px] leading-relaxed">{msg.text}</p>
                   ) : (
                     <div className="flex flex-col items-center">
                       <p className="text-sm italic mb-2">Anexo: {msg.type}</p>
                       <span className="text-xs break-all opacity-80">{msg.media?.original_url || 'URL indisponível'}</span>
                     </div>
                   )}
                   <div className={`text-[11px] mt-2 text-right ${isOut ? 'text-blue-200' : 'text-gray-400'}`}>
                     {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} • {msg.status}
                   </div>
                 </div>
               </div>
            );
          })}
        </div>
      </main>

      {/* Input Area */}
      <footer className="p-4 bg-white dark:bg-gray-900 border-t dark:border-gray-800">
        <form onSubmit={handleSend} className="max-w-4xl mx-auto flex items-end space-x-4">
          <button type="button" className="p-3 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors rounded-full hover:bg-gray-100 dark:hover:bg-gray-800">
            <Paperclip className="w-6 h-6" />
          </button>
          <div className="flex-1 bg-gray-100 dark:bg-gray-800 rounded-2xl overflow-hidden border border-transparent focus-within:border-blue-500 focus-within:bg-white dark:focus-within:bg-gray-900 transition-colors">
            <textarea 
              value={text}
              onChange={e => setText(e.target.value)}
              placeholder="Digite sua mensagem para o lead..."
              className="w-full bg-transparent border-none focus:ring-0 resize-none px-4 py-3 h-14 text-gray-900 dark:text-gray-100"
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSend(e as any);
                }
              }}
            />
          </div>
          <button type="submit" disabled={!text.trim()} className="p-3 bg-gradient-to-br from-blue-600 to-indigo-500 hover:from-blue-700 hover:to-indigo-600 disabled:opacity-50 disabled:hover:from-blue-600 text-white rounded-full transition-colors shadow-lg shadow-blue-600/20">
            <Send className="w-6 h-6" />
          </button>
        </form>
      </footer>
    </div>
  );
}
