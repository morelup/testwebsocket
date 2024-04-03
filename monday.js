
var authKey = "";
function authKeySet(value){authKey = value}
var https = require('follow-redirects').https;
var fs = require('fs');
const fetch = require('node-fetch');

function uploadFile(msg,item){
	try{
		var options = {
		  'method': 'POST',
		  'hostname': 'api.monday.com',
		  'path': '/v2/file',
		  'headers': {
			'Authorization': authKey
		  },
		  'maxRedirects': 20
		};
		var req = https.request(options, function (res) {
		  var chunks = [];
		  res.on("data", function (chunk) {
			chunks.push(chunk);
		  });
		  res.on("end", function (chunk) {
			var body = Buffer.concat(chunks);
		  });
		  res.on("error", function (error) {
			console.error(error);
		  });
		});
		var postData = "------WebKitFormBoundary7MA4YWxkTrZu0gW\r\nContent-Disposition: form-data; name=\"query\"\r\n\r\nmutation add_file($file: File!) {add_file_to_column (item_id: "+item+", column_id:\"doc\" file: $file) {id}}\r\n------WebKitFormBoundary7MA4YWxkTrZu0gW\r\nContent-Disposition: form-data; name=\"map\"\r\n\r\n{\"image\":\"variables.file\"}\r\n------WebKitFormBoundary7MA4YWxkTrZu0gW\r\nContent-Disposition: form-data; name=\"image\"; filename=\""+msg.subitem+".json\"\r\nContent-Type: \"text/json\"\r\n\r\n"+msg.calllog+"\r\n------WebKitFormBoundary7MA4YWxkTrZu0gW--";
		req.setHeader('content-type', 'multipart/form-data; boundary=----WebKitFormBoundary7MA4YWxkTrZu0gW');
		req.write(postData);
		req.end();
	} catch (error) {
		console.log(error);
	}	
}


function boardInfo(msg){
	try {
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
					subscribers{
						id
						name
					}
					groups  {
						title
						id
					}
				}
			}`
		});
		return callApi(body);
	} catch (error) {
		console.log(error);
	}	
}

function getItems(msg){
	try {
		var body = JSON.stringify({
			query: `query {
				boards (ids: [${msg}]) {
					items_page{
						items {
							id
							name 
						} 
					}
				}
			}`
		});
		return callApi(body);
	} catch (error) {
		console.log(error);
	}	
}


function callApi(body) {
  return fetch('https://api.monday.com/v2', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': authKey
    },
    body: body,
  }).then(res => res.text());
}




function getBoardColumns(board){
	var columns = board.data.boards[0].columns;
	var returnObject = {};
	columns.forEach(value =>{
		returnObject[value["title"]] = value["id"]
	})
	return returnObject
}


function confirmParentColumns(board) {
  var columns = getBoardColumns(board);
  var requiredColumns = ['Reported Date', 'Expected Behavior', 'Actual Behavior', 'Subitems'];
  for (var i = 0; i < requiredColumns.length; i++) {
    if (!(requiredColumns[i] in columns)) {
      console.log(requiredColumns[i] + ' Fail');
      return false;
    }
  }
  return true;
}
function confirmSubitemColumns(board) {
  var requiredColumns = ['Result', 'VCC Call ID', 'Timestamp', "Caller's Phone Number", 'Notes', 'Caller'];
  var columns = getBoardColumns(board);
  return requiredColumns.every(column => column in columns);
}
function getBoardID(board)
{
	return board.data.boards[0].id;
}
function getGroupID(board)
{
	return board.data.boards[0].groups[0].id;
}



function DateTimeNow() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}


function createDefect(board,msg) {
	try{
		const columns = getBoardColumns(board);
		const column_values = {
			[columns["Reported Date"]]:DateTimeNow(),
			[columns["Expected Behavior"]]:msg["expected"],
			[columns["Actual Behavior"]]:msg["actual"]
			
		}
		if (msg["reportedby"]!= "null")
		{
			column_values[columns["Reported By"]]={"personsAndTeams":[{"id":msg["reportedby"],"kind":"person"}]};
		}
		
		const body = JSON.stringify({
		query: `mutation ($board_id: Int!, $group_id: String, $name: String, $column_values: JSON) {
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
			 board_id: parseInt(getBoardID(board)),
			 group_id: getGroupID(board),
			 column_values: JSON.stringify(column_values),
			 name: msg.item
			},
		  });
		return fetch('https://api.monday.com/v2', {
		  method: 'POST',
		  headers: {
			'Content-Type': 'application/json',
			'Authorization': authKey
		  },
		  body: body,
		})
	  .then((res) => res.text())
	} catch (error) {
		console.log(error);
	}
}

function createSubItem(board,msg,item) {
	try{
		const columns = getBoardColumns(board);
		const column_values = {};
		if (msg.callid !== "null") column_values[columns["VCC Call ID"]] = msg.callid;
		if (msg.timestamp !== "null") column_values[columns["Timestamp"]] = msg.timestamp;
		if (msg.notes !== "null") column_values[columns["Notes"]] = msg.notes;
		if (msg.reportedby !== "null") column_values[columns["Caller"]] = { personsAndTeams: [{ id: msg.reportedby, kind: "person" }] };
		if (msg.status !== "null") column_values[columns["Result"]] = msg.status;
		if (msg.ani !== "null") column_values[columns["Caller's Phone Number"]] = msg.ani;
		const variables = {
			  parent_item_id: parseInt(item),
			  column_values: JSON.stringify(column_values),
			  name: msg.subitem,
			};
		
		const body = JSON.stringify({
		query: `mutation ($parent_item_id: Int!, $name: String!, $column_values: JSON) {
		create_subitem  (
				parent_item_id: $parent_item_id, 
				item_name: $name, 
				column_values: $column_values) {
			id
			}
		}
		`,
			variables
		  });
		  console.log(body);
		return fetch('https://api.monday.com/v2', {
		  method: 'POST',
		  headers: {
			'Content-Type': 'application/json',
			'Authorization': authKey
		  },
		  body: body,
		}).then((res) => res.text())
	} catch (error) {
		console.log(error);
	}
	
}
module.exports = { uploadFile,getItems,boardInfo,authKeySet,confirmParentColumns,confirmSubitemColumns,createDefect,createSubItem};
