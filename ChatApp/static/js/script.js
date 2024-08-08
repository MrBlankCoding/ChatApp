// Global variables
const socket = io();
let chatRooms = {};
let replyingTo = null;
let onlineStatus = {};
let friendsList = [];

// Initialization
window.onload = function() {
    loadFriends();
    setupSocketListeners();
    socket.emit('get_online_status', { username: username });
    setupGroupChatButton();
};

// Socket event listeners
function setupSocketListeners() {
    socket.on('connect', () => {
        socket.emit('join_rooms');
    });

    socket.on('rooms_joined', () => {
        console.log('Joined all friend rooms');
    });

    socket.on('group_chat_created', (data) => {
        openGroupChatRoom(data.roomId, data.name, data.members);
    });

    socket.on('user_status', (data) => {
        onlineStatus[data.username] = data.status;
        updateFriendStatus(data.username, data.status);
    });

    socket.on('user_group_chats', (data) => {
        data.group_chats.forEach(chat => {
            openGroupChatRoom(chat.roomId, chat.name, chat.members);
        });
    });

    socket.on('message', (data) => {
        const room = data.room || [data.sender, username].sort().join('-');
        if (!chatRooms[room]) {
            if (room.startsWith('group_')) {
                openGroupChatRoom(room, chatRooms[room].name, chatRooms[room].members);
            } else {
                chatRooms[room] = { messages: [] };
                createChatTab(data.sender, room);
            }
        }
        
        chatRooms[room].messages.push(data);
        if (currentRoom === room) {
            appendMessage(data.id, data.sender, data.message, data.reply_to, data.image_filename, data.deleted);
        }
    });


    socket.on('message_deleted', (data) => {
        const messageElement = document.querySelector(`.message[data-id="${data.message_id}"]`);
        if (messageElement) {
            const senderElement = messageElement.querySelector('strong');
            const sender = senderElement ? senderElement.textContent : 'Unknown';
            messageElement.innerHTML = `<strong>${sender}</strong> Message deleted`;
            const actionsElement = messageElement.querySelector('.message-actions');
            if (actionsElement) {
                actionsElement.remove();
            }
        }
        const message = chatRooms[currentRoom].messages.find(m => m.id === data.message_id);
        if (message) {
            message.deleted = true;
            message.message = "Message deleted";
        }
    });

    socket.on('delete_error', (data) => {
        alert(data.error);
    });

    socket.on('reaction_updated', (data) => {
        updateReactions(data.message_id, data.reactions);
    });

    socket.on('message_edited', (data) => {
        const messageElement = document.querySelector(`.message[data-id="${data.message_id}"]`);
        if (messageElement) {
            const messageContent = messageElement.querySelector('.message-content');
            messageContent.textContent = data.new_message;
        }
        const message = chatRooms[currentRoom].messages.find(m => m.id === data.message_id);
        if (message) {
            message.message = data.new_message;
        }
    });
}

// Friend and request management
function loadFriends() {
    fetch('/get_friends')
        .then(response => response.json())
        .then(friends => {
            updateFriendsList(friends);
        })
        .catch(error => console.error('Error loading friends:', error));
}

function updateFriendsList(friends) {
    friendsList = friends; // Update the global friendsList

    const friendsUl = document.getElementById('friends');
    const friendSelect = document.getElementById('friend-select');
    
    friendsUl.innerHTML = '';
    friendSelect.innerHTML = '';
    
    friends.forEach(friend => {
        // Update the friends list UI
        const li = document.createElement('li');
        li.dataset.username = friend;
        const statusIndicator = document.createElement('span');
        statusIndicator.className = 'status-indicator offline';
        statusIndicator.title = 'Offline';
        li.appendChild(statusIndicator);
        li.appendChild(document.createTextNode(friend));
        li.onclick = () => openChatRoom(friend);
        friendsUl.appendChild(li);
        
        // Add friend to the dropdown
        const option = document.createElement('option');
        option.value = friend;
        option.textContent = friend;
        friendSelect.appendChild(option);
        
        // Request status for this friend
        socket.emit('get_online_status', { username: friend });
    });
}

function updateFriendStatus(username, status) {
    const friendElement = document.querySelector(`#friends-list li[data-username="${username}"]`);
    if (friendElement) {
        const statusIndicator = friendElement.querySelector('.status-indicator') || document.createElement('span');
        statusIndicator.className = `status-indicator ${status}`;
        statusIndicator.title = status.charAt(0).toUpperCase() + status.slice(1);
        if (!friendElement.contains(statusIndicator)) {
            friendElement.insertBefore(statusIndicator, friendElement.firstChild);
        }
    }
}

// Chat room management
function openChatRoom(friend) {
    const room = [username, friend].sort().join('-');
    if (!chatRooms[room]) {
        chatRooms[room] = { messages: [] };
        createChatTab(friend, room);
    }
    showChatRoom(room);
    loadChatHistory(friend, room);
}

function createChatTab(friend, room) {
    const chatTabs = document.getElementById('chat-tabs');
    const tab = document.createElement('div');
    tab.className = 'chat-tab';
    tab.innerText = friend;
    tab.onclick = () => showChatRoom(room);
    chatTabs.appendChild(tab);
}

function showChatRoom(room) {
    currentRoom = room;
    const chatMessages = document.getElementById('chat-messages');
    chatMessages.innerHTML = '';
    chatRooms[room].messages.forEach(msg => {
        appendMessage(msg.id, msg.sender, msg.message, msg.reply_to, msg.image_filename, msg.deleted);
        updateReactions(msg.id, msg.reactions);
    });
    
    if (chatRooms[room].replyingTo) {
        setReplyTo(chatRooms[room].replyingTo);
    }
}

function loadChatHistory(friend, room) {
    fetch(`/get_chat_history/${friend}`)
        .then(response => response.json())
        .then(history => {
            chatRooms[room].messages = history;
            if (currentRoom === room) {
                showChatRoom(room);
            }
        });
}

function openGroupChatRoom(roomId, name, members) {
    if (!chatRooms[roomId]) {
        chatRooms[roomId] = { messages: [], name: name, members: members };
        createGroupChatTab(name, roomId);
    }
    showChatRoom(roomId);
    loadGroupChatHistory(roomId);
}

function createGroupChatTab(name, roomId) {
    const chatTabs = document.getElementById('chat-tabs');
    const existingTab = document.querySelector(`.chat-tab[data-room-id="${roomId}"]`);
    if (!existingTab) {
        const tab = document.createElement('div');
        tab.className = 'chat-tab';
        tab.dataset.roomId = roomId;
        tab.innerText = name;
        tab.onclick = () => showChatRoom(roomId);
        chatTabs.appendChild(tab);
    }
}
function loadGroupChatHistory(roomId) {
    fetch(`/get_group_chat_history/${roomId}`)
        .then(response => response.json())
        .then(history => {
            chatRooms[roomId].messages = history;
            if (currentRoom === roomId) {
                showChatRoom(roomId);
            }
        });
}

function getUserProfilePhotoURL(username) {
    return fetch(`/get_user_profile?username=${username}`)
        .then(response => {
            if (response.ok) {
                return response.json();
            } else {
                console.error(`Error fetching user profile photo for ${username}: ${response.status} - ${response.statusText}`);
                return { profile_photo: '' };
            }
        })
        .then(profile => {
            return profile.profile_photo
                ? `/static/uploads/${profile.profile_photo}`
                : '/static/default_profile.png';
        })
        .catch(error => {
            console.error('Error fetching user profile photo:', error);
            return '/static/default_profile.png';
        });
}

function setupGroupChatButton() {
    const createBtn = document.getElementById('create-group-chat-btn');
    const modal = document.getElementById('group-chat-modal');
    const confirmBtn = document.getElementById('confirm-group-chat');
    const cancelBtn = document.getElementById('cancel-group-chat');

    createBtn.onclick = () => modal.style.display = 'block';
    cancelBtn.onclick = () => modal.style.display = 'none';
    confirmBtn.onclick = createGroupChat;
}

function createGroupChat() {
    const selectedFriends = Array.from(document.getElementById('friend-select').selectedOptions).map(option => option.value);
    const groupName = document.getElementById('group-chat-name').value;
    
    if (selectedFriends.length < 2 || !groupName) {
        alert('Please select at least two friends and provide a group name.');
        return;
    }

    socket.emit('create_group_chat', {
        members: [username, ...selectedFriends],
        name: groupName
    });

    document.getElementById('group-chat-modal').style.display = 'none';
}

// Message handling
function sendMessage(imageFilename = null) {
    const messageInput = document.getElementById('message');
    const message = messageInput.value;
    if ((message.trim() !== '' || imageFilename) && currentRoom) {
        const recipient = currentRoom.replace(username, '').replace('-', '');

        const messageId = Date.now().toString(); // Temporary ID
        const messageData = {
            id: messageId,
            sender: username,
            message: message,
            reply_to: replyingTo,
            image_filename: imageFilename
        };

        chatRooms[currentRoom].messages.push(messageData);
        appendMessage(messageId, username, message, replyingTo, imageFilename);

        socket.emit('message', {
            sender: username,
            recipient: recipient,
            room: currentRoom,
            message: message,
            reply_to: replyingTo,
            image_filename: imageFilename
        });
        messageInput.value = '';
        cancelReply();
    }
}

// Modify the appendMessage function to display images
async function appendMessage(messageId, sender, message, replyTo = null, imageFilename = null, deleted = false) {
    const chatMessages = document.getElementById('chat-messages');
    const messageElement = document.createElement('div');
    messageElement.className = 'message';
    messageElement.dataset.id = messageId;

    const senderProfilePhotoURL = await getUserProfilePhotoURL(sender);

    let messageContent = `
        <div class="message-header">
            <img src="${senderProfilePhotoURL}" alt="${sender}'s profile photo" class="profile-photo">
            <strong>${sender}:</strong>
        </div>
        <span class="message-content">${deleted ? "Message deleted" : message}</span>
    `;

    if (replyTo) {
        const replyMessage = chatRooms[currentRoom].messages.find(m => m.id === replyTo);
        if (replyMessage) {
            messageContent = `<div class="reply-to">Replying to ${replyMessage.sender}: ${replyMessage.deleted ? "Message deleted" : replyMessage.message}</div>` + messageContent;
        }
    }

    if (imageFilename && !deleted) {
        messageContent += `<br><img src="/static/uploads/${imageFilename}" alt="Uploaded image" style="max-width: 200px;">`;
    }

    messageElement.innerHTML = messageContent;

    const actionsElement = document.createElement('div');
    actionsElement.className = 'message-actions';

    if (!deleted) {
        const replyButton = document.createElement('button');
        replyButton.innerText = 'Reply';
        replyButton.onclick = () => setReplyTo(messageId);
        actionsElement.appendChild(replyButton);

        if (sender === username) {
            const deleteButton = document.createElement('button');
            deleteButton.innerText = 'Delete';
            deleteButton.onclick = () => deleteMessage(messageId);
            actionsElement.appendChild(deleteButton);

            // Add edit button
            const editButton = document.createElement('button');
            editButton.innerText = 'Edit';
            editButton.onclick = () => editMessage(messageId);
            actionsElement.appendChild(editButton);
        }

        const emojiButton = createEmojiButton(messageElement);
        emojiButton.style.display = 'none'; // Hide by default
        actionsElement.appendChild(emojiButton);
    }

    messageElement.appendChild(actionsElement);
    chatMessages.appendChild(messageElement);

    messageElement.onmouseover = () => {
        const emojiButton = messageElement.querySelector('.emoji-button');
        if (emojiButton) emojiButton.style.display = 'inline-block';
    };
    messageElement.onmouseout = () => {
        const emojiButton = messageElement.querySelector('.emoji-button');
        if (emojiButton) emojiButton.style.display = 'none';
    };

    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function createEmojiButton(messageElement) {
    const emojiButton = document.createElement('button');
    emojiButton.className = 'emoji-button';
    emojiButton.innerText = '😀';
    emojiButton.onclick = (event) => {
        event.stopPropagation();
        showEmojiPicker(messageElement);
    };
    return emojiButton;
}

function showEmojiPicker(messageElement) {
    const existingPicker = document.querySelector('.emoji-picker');
    if (existingPicker) {
        existingPicker.remove();
    }

    const emojiPicker = document.createElement('div');
    emojiPicker.className = 'emoji-picker';
    const emojis = ['👍', '❤️', '😂', '😮', '😢', '😡'];
    emojis.forEach(emoji => {
        const emojiSpan = document.createElement('span');
        emojiSpan.innerText = emoji;
        emojiSpan.onclick = () => addReaction(messageElement, emoji);
        emojiPicker.appendChild(emojiSpan);
    });
    messageElement.appendChild(emojiPicker);
}

function addReaction(messageElement, emoji) {
    const messageId = messageElement.dataset.id;
    socket.emit('add_reaction', { message_id: messageId, emoji: emoji, room: currentRoom });
    messageElement.querySelector('.emoji-picker').remove();
}

function updateReactions(messageId, reactions) {
    const messageElement = document.querySelector(`.message[data-id="${messageId}"]`);
    if (messageElement) {
        let reactionsElement = messageElement.querySelector('.reactions');
        if (!reactionsElement) {
            reactionsElement = document.createElement('div');
            reactionsElement.className = 'reactions';
            messageElement.appendChild(reactionsElement);
        }
        reactionsElement.innerHTML = '';
        for (const [emoji, count] of Object.entries(reactions)) {
            const reactionSpan = document.createElement('span');
            reactionSpan.className = 'reaction';
            reactionSpan.innerText = `${emoji} ${count}`;
            reactionsElement.appendChild(reactionSpan);
        }
    }
}

function editMessage(messageId) {
    const messageElement = document.querySelector(`.message[data-id="${messageId}"]`);
    const messageContent = messageElement.querySelector('.message-content');
    const currentMessage = messageContent.textContent;

    const inputElement = document.createElement('input');
    inputElement.type = 'text';
    inputElement.value = currentMessage;
    inputElement.className = 'edit-input';

    const saveButton = document.createElement('button');
    saveButton.innerText = 'Save';
    saveButton.onclick = () => saveEdit(messageId, inputElement.value);

    const cancelButton = document.createElement('button');
    cancelButton.innerText = 'Cancel';
    cancelButton.onclick = () => cancelEdit(messageId, currentMessage);

    messageContent.innerHTML = '';
    messageContent.appendChild(inputElement);
    messageContent.appendChild(saveButton);
    messageContent.appendChild(cancelButton);
}

function saveEdit(messageId, newMessage) {
    socket.emit('edit_message', { message_id: messageId, new_message: newMessage, room: currentRoom });
}

function cancelEdit(messageId, originalMessage) {
    const messageElement = document.querySelector(`.message[data-id="${messageId}"]`);
    const messageContent = messageElement.querySelector('.message-content');
    messageContent.textContent = originalMessage;
}

function setReplyTo(messageId) {
    replyingTo = messageId;
    chatRooms[currentRoom].replyingTo = messageId;
    const replyToElement = document.getElementById('reply-to');
    const replyMessage = chatRooms[currentRoom].messages.find(m => m.id === messageId);
    replyToElement.innerHTML = `Replying to ${replyMessage.sender}: ${replyMessage.deleted ? "Message deleted" : replyMessage.message}`;
    replyToElement.style.display = 'block';
}

function uploadImage() {
    const input = document.getElementById('image-upload');
    const file = input.files[0];
    if (file) {
        const formData = new FormData();
        formData.append('file', file);

        fetch('/upload', {
            method: 'POST',
            body: formData
        })
        .then(response => response.json())
        .then(data => {
            if (data.filename) {
                sendMessage(data.filename);
            } else {
                alert('Error uploading image');
            }
        })
        .catch(error => {
            console.error('Error:', error);
            alert('Error uploading image');
        });
    }
}

function cancelReply() {
    replyingTo = null;
    if (currentRoom) {
        chatRooms[currentRoom].replyingTo = null;
    }
    const replyToElement = document.getElementById('reply-to');
    replyToElement.innerHTML = '';
    replyToElement.style.display = 'none';
}

function deleteMessage(messageId) {
    socket.emit('delete_message', { message_id: messageId, room: currentRoom });
}

// Clean up
window.onbeforeunload = function() {
    if (currentRoom) {
        socket.emit('leave', {username: username, room: currentRoom});
    }
    
};
