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

// Test harness: a tester can spoof the ANI/DNIS the IVA should use for their call.
// Kept on the tester's own socket (socket.data.spoof) under their real ANI (the one in "Assign ANI"), so it
// only lasts while their page is connected. The IVA looks it up with GET /spoof?ani=... by checking the open sockets.
const lookupLimit = rateLimiter(600, 60 * 1000);          // spoof lookups, per IP per minute

// The spoof in effect for a real ANI. A new spoof replaces any other tab's for the same number,
// so there is normally only one; if two ever exist, the most recently set one wins.
function findSpoof(key) {
  let entry = null;
  for (const tester of io.sockets.sockets.values()) {
    const spoof = tester.data.spoof;
    if (key && spoof && spoof.callerAni === key && (!entry || spoof.setAt > entry.setAt)) entry = spoof;
  }
  return entry;
}

// A phone number as typed by a tester: optional +, digits only once spaces/dashes/brackets are removed.
// Returns "" for blank (meaning "don't spoof this one") and null when it isn't a phone number.
function cleanPhone(value) {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value !== 'string') return null;
  const phone = value.replace(/[\s().-]/g, '');
  if (phone === '') return '';
  return /^\+?\d{1,20}$/.test(phone) ? phone : null;
}

// Room names are phone numbers, board ids or group ids. A US number can arrive as +13173811823,
// 13173811823 or 3173811823, so all three become the 10 digit form and land in the same room.
function cleanRoom(msg) {
  if (msg === undefined || msg === null) return null;
  msg = msg.toString().replace("+1","");
  if (/^1\d{10}$/.test(msg)) msg = msg.slice(1);
  return /^[\w-]{1,64}$/.test(msg) ? msg : null;
}

// A submission needs a board this socket is locked to, every field must be plain text of a sane size,
// and "reported by" must be "null" or someone subscribed to that board.
// Returns "" when the submission is fine, otherwise the reason it was refused (written to the log).
function submissionProblem(socket, msg) {
  if (!socket.data.boardId) return "this connection has no board (connect_boarddata did not succeed)";
  if (!msg || typeof msg !== 'object') return "the message is not an object";
  const maxLengths = {
    reportedby: 30, item: 255, subitem: 255, callid: 100, timestamp: 100,
    ani: 30, notes: 10000, status: 100, expected: 10000, actual: 10000,
    calllog: 5e7
  };
  const badField = Object.keys(maxLengths).find(field =>
    msg[field] !== undefined && (typeof msg[field] !== 'string' || msg[field].length > maxLengths[field]));
  if (badField) return "field " + badField + " is not text or is too long";
  const subscribers = boards[socket.data.boardId].parentBoard.data.boards[0].subscribers.map(person => String(person.id));
  if (msg.reportedby !== undefined && msg.reportedby !== "null" && !subscribers.includes(msg.reportedby)) {
    return "reportedby " + String(msg.reportedby).slice(0, 30) + " is not subscribed to board " + socket.data.boardId;
  }
  return "";
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


  // Same cleaning as join uses, so the rooms match whichever form the number or id arrives in
  const aniRoom = cleanRoom(ANI);
  const boardRoom = cleanRoom(queryObject.boardId);
  const groupRoom = cleanRoom(req.body[0].group_id);
  try {
    if (ANI != "ERROR")
	{
		if (aniRoom && io.sockets.adapter.rooms.has(aniRoom)) {
		  io.to(aniRoom).emit('us7 message', req.body);
		}
		if(boardRoom && queryObject.openListen)
		{
			if(queryObject.openListen=="yes")
			{
				if (io.sockets.adapter.rooms.has(boardRoom)) {
				  io.to(boardRoom).emit('us7 message', req.body);
				}
			}
		}
	}
	else
	{
		if(boardRoom)
		{
			if (io.sockets.adapter.rooms.has(boardRoom)) {
			  io.to(boardRoom).emit('us7 message', req.body);
			}
			if (groupRoom && io.sockets.adapter.rooms.has(groupRoom)) {
			  io.to(groupRoom).emit('us7 message', req.body);
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

// The IVA calls this with the real caller's ANI to find out whether the tester set an ANI/DNIS to spoof.
// Always answers 200 so the IVA can branch on "found" instead of handling an error.
app.get('/spoof', (req, res) => {
  res.set('Cache-Control', 'no-store');
  const forwarded = req.headers['x-forwarded-for'];
  const ip = forwarded ? forwarded.split(',')[0].trim() : req.socket.remoteAddress;
  if (!lookupLimit(ip)) return res.status(429).json({ found: false, error: 'Too many requests' });

  // An unencoded "+" in a query string arrives as a space, so turn a leading space back into the +
  let raw = String(req.query.ani ?? '');
  if (raw.startsWith(' ')) raw = '+' + raw.trim();
  const key = cleanRoom(raw.trim());
  const entry = findSpoof(key);
  if (!entry) return res.json({ found: false });
  res.json({ found: true, ani: entry.ani, dnis: entry.dnis });
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
	const problem = submissionProblem(socket,msg);
	if (problem) {
	  console.error("create_defect refused: " + problem);
	  return socket.emit('create_defect_failure');
	}
    create_defect(socket,msg);
  }));
  socket.on('create_defect_subitem', safe(msg => {
	console.log("socket: create_defect_subitem:");
	const problem = submissionProblem(socket,msg) || (/^\d+$/.test(msg.item) ? "" : "item is not a Monday item id: " + String(msg.item).slice(0, 50));
	if (problem) {
	  console.error("create_defect_subitem refused: " + problem);
	  return socket.emit('create_defect_failure');
	}
    create_retest(socket,msg);
  }));
  socket.on('set_spoof', safe(msg => {
	console.log("socket: set_spoof:");
	const key = msg && cleanRoom(msg.callerAni);
	const ani = msg && cleanPhone(msg.ani);
	const dnis = msg && cleanPhone(msg.dnis);
	if (!key || ani === null || dnis === null) return socket.emit('spoof_failure');
	// Setting (or clearing) a spoof for this number replaces any other open tab's, and that tab is told
	for (const tester of io.sockets.sockets.values()) {
		if (tester !== socket && tester.data.spoof && tester.data.spoof.callerAni === key) {
			delete tester.data.spoof;
			tester.emit('spoof_replaced', { callerAni: key });
		}
	}
	// Setting both blank clears whatever this tester had set
	if (!ani && !dnis) delete socket.data.spoof;
	else socket.data.spoof = { callerAni: key, ani, dnis, setAt: Date.now() };
	socket.emit('spoof_set', { callerAni: key, ani, dnis });
  }));
  // Lets a tab see a spoof another tab already has for this number (blank ani and dnis when there is none)
  socket.on('get_spoof', safe(msg => {
	console.log("socket: get_spoof:");
	const key = cleanRoom(msg);
	if (!key) return;
	const entry = findSpoof(key);
	socket.emit('spoof_current', { callerAni: key, ani: entry ? entry.ani : '', dnis: entry ? entry.dnis : '' });
  }));
  socket.on('connect_boarddata', safe(msg => {
	console.log("socket: connect_boarddata:msg");
    connect_boarddata(socket,msg);
  }));
  socket.on('get_items', safe(msg => {
	console.log("socket: get_items:");
    get_items(socket);
  }));
  socket.on('test', msg => {
  });
});

// Only the board this socket is locked to (checked by connect_boarddata) can be listed
function get_items(socket) {
  if (!socket.data.boardId) return;
  monday.getItems(socket.data.boardId).then(result => {
    socket.emit('get_items_response',JSON.parse(result));
  }).catch(error => {
    console.error(error);
  });
}

function create_defect(socket,msg) {
  monday.createDefect(boards[socket.data.boardId].parentBoard,msg).then(result => {
	  console.log("DefectCreated" + result);
    create_subItem(socket,boards[socket.data.boardId].subitemBoard,msg,JSON.parse(result).data.create_item.id);
  }).catch(error => {
	console.error("FAILED TO CREATE DEFECT!!");
    console.error(error);
	socket.emit('create_defect_failure');
  });
}

// A retest adds a subitem to an existing defect, which must be an item on this socket's board
function create_retest(socket,msg) {
  console.log("Retest: checking that item " + msg.item + " is on board " + socket.data.boardId);
  monday.getItemBoard(msg.item).then(result => {
    const data = JSON.parse(result).data;
    const items = data && data.items;
    if (!items || items.length != 1 || !items[0].board || items[0].board.id != socket.data.boardId) {
      console.error("Retest refused: item " + msg.item + " is not on board " + socket.data.boardId + ". Monday said: " + result);
      return socket.emit('create_defect_failure');
    }
    console.log("Retest: item " + msg.item + " is on the board, adding the subitem");
    create_subItem(socket,boards[socket.data.boardId].subitemBoard,msg,msg.item);
  }).catch(error => {
    console.error("FAILED RETEST for item " + msg.item);
    console.error(error);
	socket.emit('create_defect_failure');
  });
}

function create_subItem(socket,board,msg,item) {
  monday.createSubItem(board,msg,item).then(result => {
    const data = JSON.parse(result).data;
    if (!data || !data.create_subitem) { // Monday refused it, so log why
      console.error("Monday did not create the subitem under item " + item + ": " + result);
      return socket.emit('create_defect_failure');
    }
    console.log("Subitem " + data.create_subitem.id + " created under item " + item);
    socket.emit('defect_created',"");
    monday.uploadFile(msg,data.create_subitem.id);
  }).catch(error => {
    console.error(error);
	console.error(JSON.stringify({...msg, calllog: undefined}));
	socket.emit('create_defect_failure');
  });
}


async function connect_boarddata(socket, msg) {
	if (socket.data.boardId) return; // this socket is already locked to a board
	socket.data.boardAttempts = (socket.data.boardAttempts || 0) + 1;
	if (socket.data.boardAttempts > 5) return; // slows down guessing board ids
	console.log("newconnection");
    try {
        // One plain board id only, a list would send back other boards' details too
        if (typeof msg !== 'string' && typeof msg !== 'number') throw new Error("Invalid board id");
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
        if (socket.data.boardId) return; // another request locked this socket while we waited on Monday
        socket.data.boardId = parentBoard.data.boards[0].id;
        boards[socket.data.boardId] = response;
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
