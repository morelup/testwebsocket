
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
			'Authorization': mondayAuthKey
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
				'Authorization': mondayAuthKey
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


module.exports = { boardInfo};