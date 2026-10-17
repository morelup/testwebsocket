'use strict';

const express = require('express');
const app = express();
const server = require('http').Server(app);
const url = require('url');
const fetch = require('node-fetch');
const {SecretManagerServiceClient} = require('@google-cloud/secret-manager');
const client = new SecretManagerServiceClient();
const monday = require('./monday.js');
const boards = {};
accessSecret("MondayAuthKey").then(result => {monday.authKeySet(result)}).catch(error => console.error("Could not load MondayAuthKey", error));
app.use(express.static(__dirname + '/public'));

// The Five9 webhook sends one node log at a time, so it never needs a big body
app.use(express.json({limit:'1mb'}));

// Keep one bad request from taking the whole server down
process.on('unhandledRejection', error => console.error('Unhandled rejection:', error));

const io = require('socket.io')(server, {
  maxHttpBufferSize: 5e7, // 50MB, the biggest call log a tester can submit
  cors: {
    origin: ["https://us7.studioportal.io", "https://test-orelup-aia.ue.r.appspot.com"],
    methods: ["GET", "POST"],
	transports: ['websocket'] 
  }
});



// Simple in-memory rate limiter: each key gets `max` hits per `windowMs`.
// Returns true while the key is still under the limit.
function rateLimiter(max, windowMs) {
  const hits = new Map();
  setInterval(() => hits.clear(), windowMs).unref();
  return key => {
    const count = (hits.get(key) || 0) + 1;
    hits.set(key, count);
    return count <= max;
  };
}
const eventLimit = rateLimiter(300, 60 * 1000);           // any socket event, per IP per minute
const submitLimit = rateLimiter(60, 10 * 60 * 1000);      // defect submissions, per IP per 10 minutes
const submitLimitAll = rateLimiter(600, 60 * 60 * 1000);  // defect submissions, everyone, per hour
const submitEvents = ['create_defect', 'create_defect_subitem'];

// The address Google passes along; a determined attacker can fake it, which is
// why submitLimitAll caps everyone together as a backstop
function clientIp(socket) {
  const forwarded = socket.handshake.headers['x-forwarded-for'];
  return forwarded ? forwarded.split(',')[0].trim() : socket.handshake.address;
}

// Room names are phone numbers, board ids or group ids
function cleanRoom(msg) {
  if (msg === undefined || msg === null) return null;
  msg = msg.toString().replace("+1","");
  return /^[\w-]{1,64}$/.test(msg) ? msg : null;
}

// A submission must be for a board we loaded, and every field must be plain text of a sane size
function validSubmission(msg) {
  if (!msg || typeof msg !== 'object' || !Object.hasOwn(boards, msg.board)) return false;
  const maxLengths = {
    board: 30, reportedby: 30, item: 255, subitem: 255, callid: 100, timestamp: 100,
    ani: 30, notes: 10000, status: 100, expected: 10000, actual: 10000,
    calllog: 5e7
  };
  return Object.keys(maxLengths).every(field =>
    msg[field] === undefined || (typeof msg[field] === 'string' && msg[field].length <= maxLengths[field]));
}

app.post('/', (req, res) => {
  const queryObject = url.parse(req.url, true).query;
  const ifDebug = "debug" in queryObject;

  if (!Array.isArray(req.body) || !req.body[0] || typeof req.body[0].node_values !== 'object' || req.body[0].node_values === null) {
    return res.status(400).send("Unexpected payload");
  }

  let ANI = req.body[0].node_values.XSIP_x_five9ani;
  if (!ANI) {
  	const from = req.body[0].node_values.XSIP_from || "";
  	// Look for digits (possibly with +) between sip: and @
  	const match = from.match(/<sip:(\+?\d+)@/);
  	if (match) {
  	  ANI = match[1];
  	} else {
  	  ANI = "ERROR";
  	}
	}


  try {
    if (ANI != "ERROR")
	{
		if (io.sockets.adapter.rooms.has(ANI.toString().replace("+1",""))) {
		  io.to(ANI.toString().replace("+1","")).emit('us7 message', req.body);
		}
		if(queryObject.boardId && queryObject.openListen)
		{
			if(queryObject.openListen=="yes")
			{
				if (io.sockets.adapter.rooms.has(queryObject.boardId)) {
				  io.to(queryObject.boardId).emit('us7 message', req.body);
				}
			}
		}
	}
	else
	{
		if(queryObject.boardId)
		{
			if (io.sockets.adapter.rooms.has(queryObject.boardId)) {
			  io.to(queryObject.boardId).emit('us7 message', req.body);
			}
			if (io.sockets.adapter.rooms.has(req.body[0].group_id)) {
			  io.to(req.body[0].group_id).emit('us7 message', req.body);
			}
		}
	}
  } catch (error) {
    console.log(error);
  }
  res.send(req.body);
});

app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html');
});


// Run a socket handler so that a bad message from a client is logged instead of crashing the server
function safe(handler) {
  return msg => {
    try {
      handler(msg);
    } catch (error) {
      console.error(error);
    }
  };
}

let bRunFirstSocket = true;
io.on('connection', socket => {
  if (bRunFirstSocket) {
    bRunFirstSocket = false;
  }

  // Runs before every event below: stops floods and bulk submissions
  const ip = clientIp(socket);
  socket.use(([event], next) => {
    if (!eventLimit(ip)) return;
    if (submitEvents.includes(event) && !(submitLimit(ip) && submitLimitAll("all"))) {
      console.error("Submission limit reached for " + ip);
      socket.emit('create_defect_failure');
      return;
    }
    next();
  });

  socket.on('join', safe(msg => {
	console.log("socket: join:"+ msg);
	const room = cleanRoom(msg);
	if (room) socket.join(room);
  }));
  socket.on('leave', safe(msg => {
	console.log("socket: leave:"+ msg);
	const room = cleanRoom(msg);
	if (room) socket.leave(room);
  }));
  socket.on('create_defect', safe(msg => {
	console.log("socket: create_defect:");
	if (!validSubmission(msg)) return socket.emit('create_defect_failure');
    create_defect(socket,msg);
  }));
  socket.on('create_defect_subitem', safe(msg => {
	console.log("socket: create_defect_subitem:");
	if (!validSubmission(msg) || !/^\d+$/.test(msg.item)) return socket.emit('create_defect_failure');
    create_subItem(socket,boards[msg.board].subitemBoard,msg,msg.item);
  }));
  socket.on('connect_boarddata', safe(msg => {
	console.log("socket: connect_boarddata:msg");
    connect_boarddata(socket,msg);
  }));
  socket.on('get_items', safe(msg => {
	console.log("socket: get_items:");
    get_items(socket,msg);
  }));
  socket.on('test', msg => {
  });
});

// Only boards that connect_boarddata already checked (right columns) can be listed
function get_items(socket,msg) {
  if (msg === undefined || msg === null || !Object.hasOwn(boards, msg)) return;
  monday.getItems(msg).then(result => {
    socket.emit('get_items_response',JSON.parse(result));
  }).catch(error => {
    console.error(error);
  });
}

function create_defect(socket,msg) {
  monday.createDefect(boards[msg.board].parentBoard,msg).then(result => {
	  console.log("DefectCreated" + result);
    create_subItem(socket,boards[msg.board].subitemBoard,msg,JSON.parse(result).data.create_item.id);
  }).catch(error => {
	console.error("FAILED TO CREATE DEFECT!!");
    console.error(error);
	socket.emit('create_defect_failure');
  });
}

function create_subItem(socket,board,msg,item) {
  monday.createSubItem(board,msg,item).then(result => {
    socket.emit('defect_created',"");
    monday.uploadFile(msg,JSON.parse(result).data.create_subitem.id);
  }).catch(error => {
    console.error(error);
	console.error(JSON.stringify({...msg, calllog: undefined}));
	socket.emit('create_defect_failure');
  });
}


async function connect_boarddata(socket, msg) {
	console.log("newconnection");
    try {
        const parentBoard = JSON.parse(await monday.boardInfo(msg));
        if (parentBoard.data.boards.length == 0 || !(monday.confirmParentColumns(parentBoard))) {
            socket.emit('boardNotFound', parentBoard.data.boards.length == 0 ? "No Parent Board Found" : "Parent columns not correct");
            return;
        }
        const subitemBoard = JSON.parse(await monday.boardInfo(JSON.parse(parentBoard.data.boards[0].columns[1].settings_str).boardIds));
        if (!(monday.confirmSubitemColumns(subitemBoard))) {
            socket.emit('boardNotFound', "Subitem columns not correct");
            return;
        }
        const response = {
            parentBoard: parentBoard,
            subitemBoard: subitemBoard
        };
        boards[parentBoard.data.boards[0].id] = response;
        socket.emit('boardFound', response);
    } catch (error) {
        socket.emit('boardNotFound', error);
    }
}




async function accessSecret(name) {
  const secretName = `projects/${process.env.GOOGLE_CLOUD_PROJECT}/secrets/${name}/versions/latest`;
  const [version] = await client.accessSecretVersion({ name: secretName });
  return version.payload.data.toString();
}





//socket.on('join', msg => {});
if (module === require.main) {
  const PORT = parseInt(process.env.PORT) || 8080;
  server.listen(PORT, () => {
    console.log(`App listening on port ${PORT}`);
    console.log('Press Ctrl+C to quit.');
  });
}
// [END appengine_websockets_app]

module.exports = server;
