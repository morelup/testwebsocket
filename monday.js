
var authKey = "";
function authKeySet(value){authKey = value}


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
					id
				}
		  }
		}
		`});
		return fetch('https://api.monday.com/v2', {
		  method: 'POST',
		  headers: {
			'Content-Type': 'application/json',
			'Authorization': authKey
		  },
		  body: body,
		}).then(res => res.text())
	} catch (error) {
		console.log(error);
	}	
}
function getBoardColumns(board){
	var columns = board.data.boards[0].columns;
	var returnObject = {};
	columns.forEach(value =>{
		returnObject[value["title"]] = value["id"]
	})
	return returnObject
}
function confirmParentColumns(board)
{
	var columns = getBoardColumns(board);
	console.log(JSON.stringify(columns));
	if(!('Reported Date' in columns))
	{console.log('Reported Date Fail');
		return false;}
	if(!('Expected Behavior' in columns))
	{console.log('Expected Behavior Fail');
		return false;}
	if(!('Actual Behavior' in columns))
	{
		console.log('Actual Behavior Fail');
		return false;}
	if(!('Subitems' in columns))
	{
		console.log('Subitems Fail');
		return false;}
	if(!('Status' in columns))
	{
		console.log('Status Fail');
		return false;}
	return true;
}
function confirmSubitemColumns(board)
{
	var columns = getBoardColumns(board);
	console.log("SUBBOARD:"+JSON.stringify(board));
	if(!('Result' in columns))
	{return false;}
	if(!('VCC Call ID' in columns))
	{return false;}
	if(!('Timestamp' in columns))
	{return false;}
	if(!('Caller\'s Phone Number' in columns))
	{return false;}
	if(!('Notes' in columns))
	{return false;}
	return true;	
}
function getBoardID(board)
{
	return board.data.boards[0].id;
}
function getGroupID(board)
{
	return board.data.boards[0].groups[0].id;
}



function DateTimeNow(){
  var a = new Date();
  return a.toISOString().replace('T', ' ').substr(0, 19);
}


function createDefect(board,msg) {
	try{
		/*
		Name
		Status
		Reported By
		Reported Date
		Expected Behavior
		Actual Behavior
		*/
		var columns = getBoardColumns(board);
		var column_values = {
			[columns["Reported Date"]]:DateTimeNow(),
			[columns["Expected Behavior"]]:msg["expected"],
			[columns["Actual Behavior"]]:msg["actual"]
		}
		console.log("BOARD:"+JSON.stringify(board));
		
		var body = JSON.stringify({
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
			 name: msg.name
			},
		  });
		  console.log(body);
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
		/*
		Name
		Result
		VCC Call ID
		Timestamp
		Caller's Phone Number
		Notes
		*/
		var columns = getBoardColumns(board);
		console.log("SUBBOARD:"+JSON.stringify(board));
		console.log("columns:"+JSON.stringify(columns));
		var column_values = {
			[columns["VCC Call ID"]]:msg["callid"],
			[columns["Reported Date"]]:DateTimeNow(),
			[columns["Timestamp"]]:msg["timestamp"],
			[columns["Notes"]]:msg["notes"]
		}
		
		
		var body = JSON.stringify({
		query: `mutation ($parent_item_id: Int!, $name: String, $column_values: JSON) {
		create_subitem  (
				parent_item_id: $parent_item_id, 
				item_name: $name, 
				column_values: $column_values) {
			id
			}
		}
		`,
			variables: {
			 parent_item_id: parseInt(item),
			 column_values: JSON.stringify(column_values),
			 name: msg.subitem
			},
		  });
		  console.log(body);
		return fetch('https://api.monday.com/v2', {
		  method: 'POST',
		  headers: {
			'Content-Type': 'application/json',
			'Authorization': authKey
		  },
		  body: body,
		})
	  .then((res) => res.text())
	  .then((result) => console.log(result));
	} catch (error) {
		console.log(error);
	}
	
}
module.exports = { boardInfo,authKeySet,confirmParentColumns,confirmSubitemColumns,createDefect,createSubItem};
8001471523

6895