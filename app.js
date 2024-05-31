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
accessSecret("MondayAuthKey").then(result => {monday.authKeySet(result)});
app.use(express.static(__dirname + '/public'));

app.use(express.json({limit:'10mb'}));
express.json({limit:'10mb'})
const io = require('socket.io')(server, {
  cors: {
    origin: "https://us7.studioportal.io",
    methods: ["GET", "POST"]
  }
});



app.post('/', (req, res) => {
  const queryObject = url.parse(req.url, true).query;
  const ifDebug = "debug" in queryObject;
  
  let ANI = req.body[0].node_values.XSIP_x_five9ani || "ERROR";
  ANI.replace("+1","");
  try {
    if (ANI != "ERROR")
	{
		if (io.sockets.adapter.rooms.has(ANI)) {
		  io.to(ANI).emit('us7 message', req.body);
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


let bRunFirstSocket = true;
io.on('connection', socket => {
  if (bRunFirstSocket) {
    bRunFirstSocket = false;
  }
  socket.on('join', msg => {
	msg = msg.replace("+1","");
    socket.join(msg);
  });
  socket.on('leave', msg => {'
    msg = msg.replace("+1","");
    socket.leave(msg);
  });
  socket.on('create_defect', msg => {
    create_defect(socket,msg);
  });
  socket.on('create_defect_subitem', msg => {
    create_subItem(socket,boards[msg.board].subitemBoard,msg,msg.item);
  });
  socket.on('connect_boarddata', msg => {
    connect_boarddata(socket,msg);
  });
  socket.on('get_items', msg => {
    get_items(socket,msg);
  });
  socket.on('test', msg => {
  });
});

function get_items(socket,msg) {
  monday.getItems(msg).then(result => {
    socket.emit('get_items_response',JSON.parse(result));
  });
}

function create_defect(socket,msg) {
  monday.createDefect(boards[msg.board].parentBoard,msg).then(result => {
	  console.log("DefectCreated" + result);
    create_subItem(socket,boards[msg.board].subitemBoard,msg,JSON.parse(result).data.create_item.id);    
  }).catch(error => {
    console.log(error);
  });
}

function create_subItem(socket,board,msg,item) {
  monday.createSubItem(board,msg,item).then(result => {
    socket.emit('defect_created',"");
    monday.uploadFile(msg,JSON.parse(result).data.create_subitem.id);
  }).catch(error => {
    console.error(error);
	console.error(JSON.stringify(msg));
  });
}


async function connect_boarddata(socket, msg) {
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
