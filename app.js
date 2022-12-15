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
const fetch = import('node-fetch');
console.log("FINDME"+process.version);

var mysql      = require('mysql');
const io = require('socket.io')(server, {
  cors: {
    origin: "https://www.orelup.org",
    methods: ["GET", "POST"]
  }
});
const {SecretManagerServiceClient} = require('@google-cloud/secret-manager');

// Instantiates a client
const client = new SecretManagerServiceClient();


var connection = mysql.createConnection({
  host     : "",
  user     : "",
  password : ""
});
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

const mondayAuthKey = accessSecret("MondayAuthKey");


app.use(express.static(__dirname + '/public'));

app.use(express.json());
app.post('/', function requestHandler(req, res) {
	console.log("newpostmessage");
    console.log("Message body: "+ JSON.stringify(req.body));
    console.log("Message body0: "+ JSON.stringify(req.body[0]));
	const queryObject = url.parse(req.url, true).query;
	var node_type = req.body[0].node_type;
	console.log("start_node "+node_type);
	if(node_type == "start_node" && "project" in queryObject)
	{
		var group_id = req.body[0].group_id;
		var instance_id = req.body[0].instance_id;
		var ANI = req.body[0].node_values.XSIP_x_five9ani;
		//var CallID = req.body[0].node_values.XSIP_x_five9callid;
		//var uuid = req.body[0].uuid;
		io.to(queryObject.project+ANI).emit('chat message',req.body[0]);
		console.log("sending message to "+queryObject.project+ANI);
		//var post = {Interaction_VCC_ID:req.body[0].node_values.XSIP_x_five9callid, 
		//			Interaction_UUID:req.body[0].uuid, 
		//			Interaction_ANI:req.body[0].node_values.XSIP_x_five9ani, 
		//			Interaction_Domain:queryObject.project};
		//var query = connection.query('INSERT INTO Interaction SET ?', post, function (error, results, fields) {
		//  if (error) throw error;
		//  console.log(results.insertId)
		//});
	}
	
	res.send(req.body);
});



app.get('/', (req, res) => {
  console.log("app directory "+__dirname);
  res.sendFile(__dirname + '/index.html');

});

io.on('connection', socket => {
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
		console.log("leave message sent for "+msg.callid);
	});
});





function createDefect(msg) {
try{
fetch('https://api.monday.com/v2', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
	'Authorization': mondayAuthKey
  },
  body: JSON.stringify({
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
  }),
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
