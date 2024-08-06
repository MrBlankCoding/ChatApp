const socket = io();

window.onload = function() {
    loadFriends();
    loadFriendRequests();
    setupSocketListeners();
};

function setupSocketListeners() {
    socket.on('user_status', (data) => {
        updateFriendStatus(data.username, data.status);
    });

    socket.on('new_friend_request', (data) => {
        loadFriendRequests();
    });

    socket.on('friend_request_response', (data) => {
        if (data.success) {
            alert('Friend request sent successfully');
        } else {
            alert(data.error);
        }
    });

    socket.on('friend_request_accepted', (data) => {
        loadFriends();
        loadFriendRequests();
    });

    socket.on('friend_request_declined', (data) => {
        loadFriendRequests();
    });
}

function loadFriends() {
    fetch('/get_friends')
        .then(response => response.json())
        .then(friends => {
            updateFriendsList(friends);
        })
        .catch(error => console.error('Error loading friends:', error));
}

function updateFriendsList(friends) {
    const friendsUl = document.getElementById('friends');
    friendsUl.innerHTML = '';
    
    friends.forEach(friend => {
        const li = document.createElement('li');
        li.dataset.username = friend;
        const statusIndicator = document.createElement('span');
        statusIndicator.className = 'status-indicator offline';
        statusIndicator.title = 'Offline';
        li.appendChild(statusIndicator);
        li.appendChild(document.createTextNode(friend));
        friendsUl.appendChild(li);
        
        socket.emit('get_online_status', { username: friend });
    });
}

function updateFriendStatus(username, status) {
    const friendElement = document.querySelector(`#friends li[data-username="${username}"]`);
    if (friendElement) {
        const statusIndicator = friendElement.querySelector('.status-indicator');
        statusIndicator.className = `status-indicator ${status}`;
        statusIndicator.title = status.charAt(0).toUpperCase() + status.slice(1);
    }
}

function loadFriendRequests() {
    fetch('/get_friend_requests')
        .then(response => response.json())
        .then(requests => {
            updateFriendRequestsList(requests);
        });
}

function updateFriendRequestsList(requests) {
    const requestsList = document.getElementById('friend-requests-list');
    requestsList.innerHTML = '';
    requests.forEach(sender => {
        const li = document.createElement('li');
        li.innerText = `${sender} `;
        const acceptButton = document.createElement('button');
        acceptButton.innerText = 'Accept';
        acceptButton.onclick = () => acceptFriendRequest(sender);
        const declineButton = document.createElement('button');
        declineButton.innerText = 'Decline';
        declineButton.onclick = () => declineFriendRequest(sender);
        li.appendChild(acceptButton);
        li.appendChild(declineButton);
        requestsList.appendChild(li);
    });
}

function sendFriendRequest() {
    const friendUsername = document.getElementById('friend-username').value;
    if (friendUsername.trim() !== '') {
        socket.emit('send_friend_request', {recipient: friendUsername});
        document.getElementById('friend-username').value = '';
    }
}

function acceptFriendRequest(sender) {
    socket.emit('accept_friend_request', {sender: sender});
}

function declineFriendRequest(sender) {
    socket.emit('decline_friend_request', {sender: sender});
}