// Copyright 2018 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//      http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

'use strict';

// [START appengine_websockets_app]
const express = require('express');
const app = express();
const server = require('http').Server(app);
const url = require('url');
const fetch = require('node-fetch');
const {SecretManagerServiceClient} = require('@google-cloud/secret-manager');
const client = new SecretManagerServiceClient();
const boards = new Array();
var mysql      = require('mysql');
var connection = mysql.createConnection({
  host     : "",
  user     : "",
  password : ""
});
var mondayAuthKey = "";

accessSecret("MondayAuthKey").then(result => mondayAuthKey = result)
app.use(express.static(__dirname + '/public'));
app.use(express.json());
var bRunFirstSocket = true;




// The Firebase Admin SDK to access Firestore.
const firebase = require('firebase-admin');
const firebaseConfig = {
  apiKey: "AIzaSyB_C4Ojo-6VNNwUzbIy_JQbKGRj6QBquUw",
  authDomain: "test-orelup-aia.firebaseapp.com",
  databaseURL: "https://test-orelup-aia-default-rtdb.firebaseio.com",
  projectId: "test-orelup-aia",
  storageBucket: "test-orelup-aia.appspot.com",
  messagingSenderId: "564770775641",
  appId: "1:564770775641:web:eb24cf739dec18657d0748",
  measurementId: "G-C5WBNR2SFP"
};
console.log("FINDME"+process.version);


const io = require('socket.io')(server, {
  cors: {
    origin: "https://www.orelup.org",
    methods: ["GET", "POST"]
  }
});

//firebase stuffs
var activeListeners = new Array();		
/*		
async function initializeFirebase() {
var secretName = 'projects/'+process.env.GOOGLE_CLOUD_PROJECT+"/secrets/Firebase/versions/latest";
  const [version] = await client.accessSecretVersion({
    name: secretName,
  });
  // Extract the payload as a string.
  const payload = JSON.parse(version.payload.data.toString());
  // WARNING: Do not print the secret in a production environment - this
  // snippet is showing how to access the secret material.
  firebase.initializeApp(payload);
  //listen for new domains
  firebase.database().ref('nodelog').on('child_added', (snapshot,context) => {
	console.log(snapshot.key);
		beginListeningDomain(snapshot.key);
	}, (errorObject) => {
	  console.log('The read failed: ' + errorObject.name);
	});
		console.log("ready");
  return ;
};
function beginListeningDomain(domainProvided)//listen for new months
{
	firebase.database().ref('nodelog/'+domainProvided).on('child_added', (snapshot) => {
		
		console.log(snapshot.key);
	beginListeningMonth(domainProvided,snapshot.key);
	}, (errorObject) => {
	  console.log('The read failed: ' + errorObject.name);
	});
}
function beginListeningMonth(domainProvided,monthProvided)//listen for new days 
{
	firebase.database().ref('nodelog/'+domainProvided+'/'+monthProvided).on('child_added', (snapshot) => {
	console.log(snapshot.key);
	beginListeningDay(domainProvided,monthProvided,snapshot.key);
	}, (errorObject) => {
	  console.log('The read failed: ' + errorObject.name);
	});
}
function beginListeningDay(domainProvided,monthProvided,dateprovided)//listen for new logs
{
	firebase.database().ref('nodelog/'+domainProvided+'/'+monthProvided+'/'+dateprovided+"/logs/hold").set("{'hold':''}");
	firebase.database().ref('nodelog/'+domainProvided+'/'+monthProvided+'/'+dateprovided+'/logs').on('child_added', (snapshot) => {
		if(snapshot.key == 'hold') return;
		var ANI = (!snapshot.val().node_values.XSIP_x_five9ani) ? "ERROR" : snapshot.val().node_values.XSIP_x_five9ani;
		var node_type = (!snapshot.val().node_type) ? "ERROR" : snapshot.val().node_type;
		console.log(snapshot.key+" - "+node_type);
		
		if(ANI != "ERROR")
		{
			console.log("phone number found");
			try{
				var node_type = (!snapshot.val().node_type) ? "ERROR" : snapshot.val().node_type;
				var payload = new Array();
				var logItem = snapshot.val();
				payload.push(logItem);
				
				if (io.sockets.adapter.rooms.has(ANI))
				{
					console.log("room found:" + ANI);
					io.to(ANI).emit('us6 message', payload);
				}
				if (io.sockets.adapter.rooms.has(ANI))
				{
					console.log("room found:" + ANI);
					io.to(ANI).emit('us6 message', payload);
				}
			} catch (error) {
				console.log(error);
			}
		}
			
		firebase.database().ref('nodelog/'+domainProvided+'/'+monthProvided+'/'+dateprovided+'/logs').child(snapshot.key).remove();
		
	}, (errorObject) => {
	  console.log('The read failed: ' + errorObject.name);
	}

	);
}
*/






accessMYSQLCred();
async function accessSecret(name) {
var secretName = 'projects/'+process.env.GOOGLE_CLOUD_PROJECT+"/secrets/"+name+"/versions/latest";
  const [version] = await client.accessSecretVersion({
    name: secretName,
  });
  // Extract the payload as a string.
  const payload = version.payload.data.toString();
  // WARNING: Do not print the secret in a production environment - this
  // snippet is showing how to access the secret material.
  console.info(`Payload: ${payload}`);
  return payload;
};


async function accessMYSQLCred() {
//console.log(JSON.stringify(process.env));
var secretName = 'projects/'+process.env.GOOGLE_CLOUD_PROJECT+"/secrets/MYSQL_HOST/versions/latest";
  const [host] = await client.accessSecretVersion({
    name: secretName,
  });
  secretName = 'projects/'+process.env.GOOGLE_CLOUD_PROJECT+"/secrets/MYSQL_USER/versions/latest";
  const [user] = await client.accessSecretVersion({
    name: secretName,
  });
  secretName = 'projects/'+process.env.GOOGLE_CLOUD_PROJECT+"/secrets/MYSQL_PASS/versions/latest";
  const [pass] = await client.accessSecretVersion({
    name: secretName,
  });
  // WARNING: Do not print the secret in a production environment - this
  // snippet is showing how to access the secret material.
  
	  connection = mysql.createConnection({
	  host     :  host.payload.data.toString(),
	  user     :  user.payload.data.toString(),
	  password :  pass.payload.data.toString(),
	  database : 'orelupor_uatpoc'
	});
	console.log(host.payload.data.toString());
	console.log(user.payload.data.toString());
	console.log(pass.payload.data.toString());
};




app.post('/', function requestHandler(req, res) {
	const queryObject = url.parse(req.url, true).query;
	const ifDebug = "debug" in queryObject;
	if (ifDebug) console.log("newpostmessage");
    if (ifDebug) console.log("Message body: "+ JSON.stringify(req.body));
    if (ifDebug) console.log("Message body0: "+ JSON.stringify(req.body[0]));
	
	var node_type = (!req.node_type) ? "ERROR" : req.node_type;
	if (ifDebug) console.log("first_node "+node_type);
	if (node_type == "ERROR") console.log("first_node "+JSON.stringify(req.body));
	var ANI = (!req.body[0].node_values.XSIP_x_five9ani) ? "ERROR" : req.body[0].node_values.XSIP_x_five9ani;
	
	//var CallID = req.body[0].node_values.XSIP_x_five9callid;
	//var uuid = req.body[0].uuid;
	
	try{
		if (io.sockets.adapter.rooms.has(ANI))
		{
			io.to(ANI).emit('us7 message', req.body);
			if (ifDebug) console.log("sending message to "+ANI);
		}
	} catch (error) {
			console.log(error);
		}
	
	//var post = {Interaction_VCC_ID:req.body[0].node_values.XSIP_x_five9callid, 
	//			Interaction_UUID:req.body[0].uuid, 
	//			Interaction_ANI:req.body[0].node_values.XSIP_x_five9ani, 
	//			Interaction_Domain:queryObject.project};
	//var query = connection.query('INSERT INTO Interaction SET ?', post, function (error, results, fields) {
	//  if (error) throw error;
	//  console.log(results.insertId)
	//});
	
	res.send(req.body);
});

app.get('/', (req, res) => {
  console.log("app directory "+__dirname);
  res.sendFile(__dirname + '/index.html');

});

io.on('connection', socket => {
	//actions to perform after socket has been connected.
	if(bRunFirstSocket)
	{
		bRunFirstSocket = false;
		
	}
	
	//socket.on('chat message', msg => {io.emit('chat message', msg);});
	socket.on('join', msg => {
		socket.join(msg);
		console.log("join message sent for "+msg);
	});
	socket.on('leave', msg => {
		socket.leave(msg);
		console.log("leave message sent for "+msg);
	});
	socket.on('defect', msg => {
		createDefect(msg);
		console.log("defect message sent for "+msg.callid);
	});
	socket.on('connect_boarddata', msg => {
		boardInfo(msg);
		console.log("boardData "+msg);
	});
});


function boardInfo(msg){
	try{
		var body = JSON.stringify({
		query: `query {
		  boards (ids: [${msg}]) {
			name
			state
			board_folder_id
			id
			columns {
					title
					type
					id
					settings_str 
				}  
			
			groups  {
					title
				}
		  }
		}
		`});
		  console.log(mondayAuthKey);
		fetch('https://ene37dtkd1z4b.x.pipedream.net/', {
		  method: 'POST',
		  headers: {
			'Content-Type': 'application/json',
			'Authorization': mondayAuthKey
		  },
		  body: body,
		}).then(res => {
			console.log(JSON.stringify(res));
			if (res.size == 0)
			{
				return;
			}
			io.to(msg.channel).emit('boardData',res);			
			var subtaskInfo = JSON.parse(res.data.boards[0].columns[1].settings_str);
			
			
			
			var body2 = JSON.stringify({
			query: `query {
			  boards (ids: [${subtaskInfo.boardIds}]) {
				name
				state
				board_folder_id
				id
				columns {
						title
						type
						id
						settings_str 
					}  
				
				groups  {
						title
					}
			  }
			}
			`,
				variables: {
				},
			  });
			fetch('https://api.monday.com/v2', {
			  method: 'POST',
			  headers: {
				'Content-Type': 'application/json',
				'Authorization': mondayAuthKey
			  },
			  body: body2,
			}).then(res2 => io.to(msg.channel).emit('subItemBoardData',res2))
			
			
			
			
		})
	  
	} catch (error) {
		console.log(error);
	}	
}


function createDefect(msg) {
	try{
		var body = JSON.stringify({
		query: `mutation ($group_id: String, $name: String, $column_values: JSON) {
		create_item (
				board_id: $board_id, 
				group_id: $group_id, 
				item_name: $name, 
				column_values: $column_values) {
			id
			}
		}
		`,
			variables: {
			 board_id: msg.board_id,
			 group_id: msg.group_id,
			 column_values: "{\"text\" : \""+msg.callid+"\",\"text6\" : \""+msg.uuid+"\"}",
			 name: msg.name
			},
		  });
		  console.log(body);
		fetch('https://api.monday.com/v2', {
		  method: 'POST',
		  headers: {
			'Content-Type': 'application/json',
			'Authorization': mondayAuthKey
		  },
		  body: body,
		})
	  .then((res) => io.to(msg.channel).emit('defect submitted',res))
	  .then((result) => console.log(result));
	} catch (error) {
		console.log(error);
	}
	
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
//initializeFirebase();//start firebase listener, needs to be delayed for race condition.  Wait till first socket connection