const { io } = require('socket.io-client');

const WS_URL = 'http://localhost:3001';
const CONVO_ID = 'c538b63f-d9f9-4f8a-8e91-6eea4a4900a2';

const socket = io(WS_URL, {
  transports: ['websocket', 'polling']
});

socket.on('connect', () => {
  console.log('Connected to WS! ID:', socket.id);
  console.log('Joining room:', CONVO_ID);
  socket.emit('join_conversation', CONVO_ID);
});

socket.on('newMessage', (msg) => {
  console.log('🚀 NEW MESSAGE RECEIVED!!', JSON.stringify(msg, null, 2));
});

socket.on('inboxUpdate', () => {
  console.log('🔄 INBOX UPDATE RECEIVED');
});

socket.on('connect_error', (err) => {
  console.error('Connection error:', err.message);
});

console.log('Monitoring socket events...');
