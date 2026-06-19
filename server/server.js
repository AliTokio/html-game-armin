const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  pingTimeout: 60000,
  pingInterval: 25000,
  allowEIO3: true
});

app.use(express.static(path.join(__dirname, '..')));

const rooms = {};

function genCode() {
  const c = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let r = '';
  for (let i = 0; i < 6; i++) r += c[Math.floor(Math.random() * c.length)];
  return rooms[r] ? genCode() : r;
}

setInterval(() => {
  const now = Date.now();
  for (const [code, room] of Object.entries(rooms)) {
    if (now - room.created > 300000) {
      if (room.host) io.to(room.host).emit('room-expired');
      if (room.guest) io.to(room.guest).emit('room-expired');
      delete rooms[code];
    }
  }
}, 30000);

io.on('connection', (socket) => {
  console.log('connected:', socket.id);

  socket.on('create-room', (cb) => {
    const code = genCode();
    rooms[code] = { host: socket.id, guest: null, created: Date.now() };
    socket.join(code);
    socket.roomCode = code;
    socket.isHost = true;
    cb({ code });
    console.log('room created:', code);
  });

  socket.on('join-room', (code, cb) => {
    code = (code || '').toUpperCase().trim();
    const room = rooms[code];
    if (!room) return cb({ error: 'Room not found' });
    if (room.guest) return cb({ error: 'Room is full' });

    room.guest = socket.id;
    socket.join(code);
    socket.roomCode = code;
    socket.isHost = false;
    cb({ success: true });
    io.to(room.host).emit('guest-joined');
    console.log('guest joined:', code);
  });

  socket.on('signal', (data) => {
    const code = socket.roomCode;
    if (!code || !rooms[code]) return;
    const room = rooms[code];
    const target = socket.isHost ? room.guest : room.host;
    if (target) io.to(target).emit('signal', data);
  });

  socket.on('disconnect', () => {
    const code = socket.roomCode;
    if (!code || !rooms[code]) return;
    const room = rooms[code];
    if (socket.isHost) {
      if (room.guest) io.to(room.guest).emit('host-disconnected');
      delete rooms[code];
      console.log('host left, room deleted:', code);
    } else {
      if (room.host) io.to(room.host).emit('guest-disconnected');
      room.guest = null;
      console.log('guest left room:', code);
    }
  });
});

app.get('/', (req, res) => res.send('Dota Zero Signaling Server OK'));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('Server running on port ' + PORT));
