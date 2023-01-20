
var authKey = "";
const boards = {};
function authKeySet(value){authKey = value}

function boardInfo(msg,socket){
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
		fetch('https://api.monday.com/v2', {
		  method: 'POST',
		  headers: {
			'Content-Type': 'application/json',
			'Authorization': authKey
		  },
		  body: body,
		}).then(res => res.text())
		.then(result => {
			var parentBoard = JSON.parse(result);
			if (parentBoard.data.boards.length == 0)
			{
				socket.emit('boardData',parentBoard);
				return;
			}
			boards[parentBoard.id] = {
				data:parentBoard
				};
			var subtaskInfo = JSON.parse(parentBoard.data.boards[0].columns[1].settings_str);
			socket.emit('boardData',parentBoard);
			
			
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
			  console.log("submitting subtask");
			fetch('https://api.monday.com/v2', {
			  method: 'POST',
			  headers: {
				'Content-Type': 'application/json',
				'Authorization': authKey
			  },
			  body: body2,
			}).then(res2 => res2.text())
			.then(result2 => {
				var subitemBoard = JSON.parse(result2);
				boards[parentBoard.id].subitemBoard = subitemBoard;
				boards[subitemBoard.id] = subitemBoard;
				socket.emit('subItemBoardData',subitemBoard)})
			
			
			
			
		})
	  
	} catch (error) {
		console.log(error);
	}	
}

function boardInfo2(msg){
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
		fetch('https://api.monday.com/v2', {
		  method: 'POST',
		  headers: {
			'Content-Type': 'application/json',
			'Authorization': authKey
		  },
		  body: body,
		}).then(res => res.text())
		.then(result => {
			var parentBoard = JSON.parse(result);
console.log("ok");
			if (parentBoard.data.boards.length == 0)
			{
				return parentBoard;
			}
			
			
			boards[parentBoard.id] = {
				data:parentBoard
				};
			return parentBoard;
			
			
			
			
			
			
			
		})
	  
	} catch (error) {
		console.log(error);
	}	
}



function createDefect(msg) {
	try{
		/*
		Name
		Status
		Reported By
		Reported Date
		Expected Behavior
		Actual Behavior
		*/
		
		
		
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

module.exports = { boardInfo2,authKeySet,boards};