const express     = require("express"),
      app         = express(),
      http        = require("http").Server(app),
      io          = require("socket.io")(http),
      morgan      = require("morgan"),
      bodyParser  = require("body-parser"),
      os          = require('os');

Date.prototype.toUnixTime = function() {
  return (this.getTime() / 1000) | 0;
};
Date.time = function() {
  return new Date().toUnixTime();
};

const indexControllers = require('./controller');

const ip = "0.0.0.0";
const port = 8080;

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept, Authorization"
  );
  res.setHeader('Access-Control-Allow-Credentials', true);
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Methods", "PUT, POST, PATCH, DELETE, GET");
    return res.status(200).json({});
  }
  next();
});

app.use(morgan('combined', {
  skip: (req, res, next) => { return res.statusCode < 400 }
}));

// Middleware
const requestMiddleware = (req, res, next) => {
  req.requestTime = Date.now();
  req.io = io;
  next();
}

app.use(requestMiddleware);
app.use("/share", express.static("share"));
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());
app.set("json spaces", 2); // pretty print

app.use("/", indexControllers);

// Socket chat
let clients = [],
    in_room = [],
    rooms   = [];
io.on("connection", (socket) => {
  let initiator = socket.handshake.query.initiator;
  let address = socket.handshake.address;
  const index = clients.findIndex(data => data['id'] === socket.id);
  if (index === -1) {
    console.log('client ' + socket.id + ' terhubung');
    clients.push({ id: socket.id, address: address, initiator: initiator });
    io.emit("users", { users: clients });
  }

  socket.on("disconnect", () => {
    const index = clients.findIndex(data => data['id'] === socket.id);
    if (index !== -1) {
      clients.splice(index, 1);
    }
    console.log('client ' + socket.id + ' terputus');
    io.emit("disconnect", socket.id);
    io.emit("user", { user: clients, event: "offline" });
  });

  // ROOM
  socket.on("subscribe", function(room) { // Create or join room
    if (rooms.indexOf(room) === -1) rooms.push(room);
    io.sockets.in(room).emit("user", { room: room, event: "join" });
    socket.join(room);
  });

  socket.on("unsubscribe", function(room) { // Leave room
    Object.keys(rooms).forEach(function(id) {
      if (rooms[id] === room) rooms.splice(id, 1);
    });
    io.sockets.in(room).emit("user", { room: room, event: "leave" });
    socket.leave(room);
  });

  socket.on("online", function(userId) {
    socket.userId = userId;
    clients = [];
    Object.keys(io.sockets.sockets).forEach(function(id) {
      clients.push({
        id: id,
        id_user: io.sockets.sockets[id].userId
      });
    });
    io.emit("user", { user: clients, event: "online" });
  });

  socket.on('in-room', (data) => {
    if (in_room.indexOf(data.userId) === -1) in_room.push(data.userId);
    io.sockets.in(data.room).emit('in-room', { room: in_room, userId: data.userId });
  });

  socket.on('out-room', (data) => {
    Object.keys(in_room).forEach(function(id) {
      if (in_room[id] == data.userId) in_room.splice(id, 1);
    });
    io.sockets.in(data.room).emit('out-room', { room: in_room, userId: data.userId });
  });

  socket.on("start-typing", (data) => {
    io.sockets.in(data.room).emit("start-typing", { room: data.room, user: data.form });
  });
  socket.on("stop-typing", (data) => {
    io.sockets.in(data.room).emit("stop-typing", { room: data.room, user: data.form });
  });
  // END ROOM

  // RTC
  socket.on("start-call", (peer) => {
    io.sockets.in(peer.room).emit("start-call", peer);
  });
  socket.on("reject-call", (peer) => {
    io.sockets.in(peer.room).emit("reject-call");
  });
  socket.on("in-call", (peer) => {
    io.sockets.in(peer.room).emit("in-call");
  });
  socket.on("chat-call", (peer) => {
    io.sockets.in(peer.room).emit("chat-call", peer);
  });
  socket.on("stop-call", (peer) => {
    io.sockets.in(peer.room).emit("stop-call");
  });

  socket.on('join', function(room) {
    var peers = io.nsps['/'].adapter.rooms[room] ? Object.keys(io.nsps['/'].adapter.rooms[room].sockets) : []
    socket.emit('peers', peers);
    socket.join(room);
  });
  socket.on('leave', function(room) {
    const index = clients.findIndex(data => data['id'] === socket.id);
    if (index !== -1) {
      clients.splice(index, 1);
    }
    socket.leave(room);
    socket.disconnect();
  });
  socket.on('signal', function(data) {
    var client = io.sockets.connected[data.id];
    client && client.emit('signal', {
      id: socket.id,
      signal: data.signal,
    });
  });
  // END RTC
});

// Handle 404
app.use((req, res, next) => {
  const error = new Error("Error 404");
  error.status = 404;
  next(error);
});

app.use((error, req, res, next) => {
  res.status(error.status || 500);
  res.json({
    error: {
      message: error.message
    }
  });
  console.log("get " + error.message);
});

http.listen(port, ip, () => {
  console.log('\x1b[43m\x1b[30m%s\x1b[0m', 'SignalingServer berjalan di:');
  const ifaces = os.networkInterfaces();
  Object.keys(ifaces).forEach(function (ifname) {
    let alias = 0;
    ifaces[ifname].forEach(function (iface) {
      if ('IPv4' !== iface.family || iface.internal !== false) {
        // skip over internal (i.e. 127.0.0.1) and non-ipv4 addresses
        console.log('\x1b[36m', '\t' + ifname + ':' + alias + ' @ ' + iface.address + ':' + port, '\x1b[0m');
        return;
      }
      if (alias >= 1) {
        // this single interface has multiple ipv4 addresses
        console.log('\x1b[36m', '\t' + ifname + ':' + alias + ' @ http://' + iface.address + ':' + port, '\x1b[0m');
      } else {
        // this interface has only one ipv4 adress
        console.log('\x1b[36m', '\t' + ifname + ' @ http://' + iface.address + ':' + port, '\x1b[0m');
      }
      ++alias;
    });
  });
});