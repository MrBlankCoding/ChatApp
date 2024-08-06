import eventlet
eventlet.monkey_patch()
from flask import Flask, render_template, request, redirect, session, jsonify
from flask_socketio import SocketIO, join_room, leave_room, emit
from pymongo import MongoClient
import secrets
import os
from werkzeug.utils import secure_filename
from flask import url_for
from bson import ObjectId
from pymongo.mongo_client import MongoClient
from pymongo.server_api import ServerApi
uri = "mongodb+srv://MrBlankCoding:MrBlankCoding@chatapp.on6bu.mongodb.net/?retryWrites=true&w=majority&appName=chatApp"

# Database Configuration
class DatabaseConfig:
    def __init__(self):
        self.client = MongoClient(uri, server_api=ServerApi('1'))
        self.db = self.client['chat_app']
        self.users = self.db['users']
        self.messages = self.db['messages']
        self.friend_requests = self.db['friend_requests']
        self.friends = self.db['friends']

# App Configuration
class AppConfig:
    def __init__(self):
        self.app = Flask(__name__)
        self.app.config['SECRET_KEY'] = secrets.token_hex(16)
        self.socketio = SocketIO(self.app)
        self.app.config['UPLOAD_FOLDER'] = 'static/uploads'
        self.app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024

# User Management
class UserManager:
    def __init__(self, db):
        self.users = db.users
        self.friends = db.friends

    def register_user(self, username, password):
        if self.users.find_one({'username': username}):
            return False
        self.users.insert_one({'username': username, 'password': password})
        return True

    def login_user(self, username, password):
        user = self.users.find_one({'username': username, 'password': password})
        return user is not None

    def get_friends(self, username):
        user_friends = self.friends.find_one({'username': username})
        if user_friends and 'friends' in user_friends:
            return user_friends['friends']
        return []
    
    def update_profile(self, username, about_me=None, profile_photo=None):
        update_data = {}
        if about_me is not None:
            update_data['about_me'] = about_me
        if profile_photo is not None:
            update_data['profile_photo'] = profile_photo
        
        if update_data:
            self.users.update_one({'username': username}, {'$set': update_data})

    def get_user_profile(self, username):
        user = self.users.find_one({'username': username})
        if user:
            return {
                'username': user['username'],
                'about_me': user.get('about_me', ''),
                'profile_photo': user.get('profile_photo', '')
            }
        return None

# Friend Request Management
class FriendRequestManager:
    def __init__(self, db):
        self.friend_requests = db.friend_requests
        self.friends = db.friends

    def send_request(self, sender, recipient):
        existing_request = self.friend_requests.find_one({
            'sender': sender,
            'recipient': recipient,
            'status': 'pending'
        })
        
        if existing_request:
            return False
        
        self.friend_requests.insert_one({
            'sender': sender,
            'recipient': recipient,
            'status': 'pending'
        })
        return True

    def accept_request(self, sender, recipient):
        self.friend_requests.update_one(
            {'sender': sender, 'recipient': recipient, 'status': 'pending'},
            {'$set': {'status': 'accepted'}}
        )
        
        self.friends.update_one(
            {'username': recipient},
            {'$addToSet': {'friends': sender}},
            upsert=True
        )
        
        self.friends.update_one(
            {'username': sender},
            {'$addToSet': {'friends': recipient}},
            upsert=True
        )

    def get_pending_requests(self, username):
        pending_requests = self.friend_requests.find({
            'recipient': username,
            'status': 'pending'
        })
        return [request['sender'] for request in pending_requests]
    
    def decline_request(self, sender, recipient):
        self.friend_requests.delete_one({
            'sender': sender,
            'recipient': recipient,
            'status': 'pending'
        })

from bson import ObjectId

class MessageManager:
    def __init__(self, db):
        self.messages = db.messages

    def save_message(self, sender, recipient, message, room, reply_to=None, image_filename=None):
        message_id = str(ObjectId())
        message_data = {
            '_id': message_id,
            'sender': sender,
            'recipient': recipient,
            'message': message,
            'room': room,
            'reply_to': reply_to,
            'image_filename': image_filename,
            'deleted': False,
            'reactions': {}  # Initialize reactions as an empty dictionary
        }
        self.messages.insert_one(message_data)
        return message_id

    def get_chat_history(self, room):
        chat_history = self.messages.find({'room': room}).sort('_id', 1)
        return [{
            'id': str(msg['_id']),
            'sender': msg['sender'],
            'message': msg['message'] if not msg['deleted'] else "Message deleted",
            'image_filename': msg.get('image_filename'),
            'reply_to': msg.get('reply_to'),
            'deleted': msg['deleted'],
            'reactions': self.get_reaction_counts(str(msg['_id']))
        } for msg in chat_history]
    
    def delete_message(self, message_id, username):
        try:
            message = self.messages.find_one({'_id': message_id})
            if message:
                if message['sender'] == username:
                    self.messages.update_one(
                        {'_id': message_id},
                        {'$set': {'deleted': True, 'message': "Message deleted"}}
                    )
                    return True
                else:
                    print(f"Username mismatch. Message sender: {message['sender']}, Deleter: {username}")  # Debug log
            else:
                print("Message not found")
        except Exception as e:
            print(f"Error deleting message: {str(e)}")
        return False
    
    def add_reaction(self, message_id, emoji, username):
        message = self.messages.find_one({'_id': message_id})
        if message:
            reactions = message.get('reactions', {})
            if emoji not in reactions:
                reactions[emoji] = []
            if username not in reactions[emoji]:
                reactions[emoji].append(username)
                self.messages.update_one(
                    {'_id': message_id},
                    {'$set': {'reactions': reactions}}
                )
            return self.get_reaction_counts(message_id)
        return None

    def get_reaction_counts(self, message_id):
        message = self.messages.find_one({'_id': message_id})
        if message and 'reactions' in message:
            return {emoji: len(users) for emoji, users in message['reactions'].items()}
        return {}
    
    def edit_message(self, message_id, new_message, username):
        message = self.messages.find_one({'_id': message_id})
        if message and message['sender'] == username:
            self.messages.update_one(
                {'_id': message_id},
                {'$set': {'message': new_message}}
            )
            return True
        return False
    
# Main Application
class ChatApp:
    def __init__(self):
        self.config = AppConfig()
        self.db = DatabaseConfig()
        self.user_manager = UserManager(self.db)
        self.friend_request_manager = FriendRequestManager(self.db)
        self.message_manager = MessageManager(self.db)
        self.setup_routes()
        self.setup_socketio()
        self.online_users = set()
        self.group_chats = {}

    def setup_routes(self):
        @self.config.app.route('/')
        def index():
            return render_template('index.html')

        @self.config.app.route('/register', methods=['GET', 'POST'])
        def register():
            if request.method == 'POST':
                username = request.form['username']
                password = request.form['password']
                if self.user_manager.register_user(username, password):
                    session['username'] = username
                    return redirect('/chat')
                return 'Username already exists'
            return render_template('register.html')

        @self.config.app.route('/login', methods=['GET', 'POST'])
        def login():
            if request.method == 'POST':
                username = request.form['username']
                password = request.form['password']
                if self.user_manager.login_user(username, password):
                    session['username'] = username
                    return redirect('/chat')
                return 'Invalid credentials'
            return render_template('login.html')

        @self.config.app.route('/logout')
        def logout():
            session.pop('username', None)
            return redirect('/')

        @self.config.app.route('/chat')
        def chat():
            if 'username' not in session:
                return redirect('/')
            return render_template('chat.html', username=session['username'])

        @self.config.app.route('/get_friends')
        def get_friends():
            if 'username' not in session:
                return jsonify([])
            return jsonify(self.user_manager.get_friends(session['username']))

        @self.config.app.route('/get_friend_requests')
        def get_friend_requests():
            if 'username' not in session:
                return jsonify([])
            return jsonify(self.friend_request_manager.get_pending_requests(session['username']))

        @self.config.app.route('/get_chat_history/<friend>')
        def get_chat_history(friend):
            if 'username' not in session:
                return jsonify([])
            room = '-'.join(sorted([session['username'], friend]))
            chat_history = self.message_manager.get_chat_history(room)
            return jsonify(chat_history)
        
        @self.config.app.route('/profile', methods=['GET', 'POST'])
        def profile():
            if 'username' not in session:
                return redirect('/login')
            
            username = session['username']
            user = self.db.users.find_one({'username': username})
            
            if request.method == 'POST':
                about_me = request.form.get('about_me')
                
                # Handle profile photo upload
                if 'profile_photo' in request.files:
                    photo = request.files['profile_photo']
                    if photo and allowed_file(photo.filename):
                        filename = secure_filename(f"{username}_profile.{photo.filename.rsplit('.', 1)[1].lower()}")
                        photo.save(os.path.join(self.config.app.config['UPLOAD_FOLDER'], filename))
                        self.db.users.update_one({'username': username}, {'$set': {'profile_photo': filename}})
                
                # Update about me
                self.db.users.update_one({'username': username}, {'$set': {'about_me': about_me}})
                
                return redirect('/profile')
            
            return render_template('profile.html', user=user)
        
        @self.config.socketio.on('search_user')
        def handle_search_user(data):
            username = data['username']
            user = self.user_manager.get_user_profile(username)
            if user:
                emit('user_search_result', {
                    'found': True,
                    'username': user['username'],
                    'profile_photo': url_for('static', filename=f"uploads/{user['profile_photo']}") if user['profile_photo'] else url_for('static', filename='default_profile.png'),
                    'about_me': user['about_me']
                })
            else:
                emit('user_search_result', {'found': False})

        @self.config.socketio.on('decline_friend_request')
        def handle_decline_friend_request(data):
            recipient = session['username']
            sender = data['sender']
            
            self.friend_request_manager.decline_request(sender, recipient)
            
            emit('friend_request_declined', {'sender': sender})
            emit('friend_request_declined', {'recipient': recipient}, room=sender)
        
        @self.config.app.route('/upload', methods=['POST'])
        def upload_file():
            if 'file' not in request.files:
                return jsonify({'error': 'No file part'}), 400
            file = request.files['file']
            if file.filename == '':
                return jsonify({'error': 'No selected file'}), 400
            if file and allowed_file(file.filename):
                filename = secure_filename(file.filename)
                file.save(os.path.join(app.config['UPLOAD_FOLDER'], filename))
                return jsonify({'filename': filename})
            return jsonify({'error': 'File type not allowed'}), 400

        def allowed_file(filename):
            ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp'}
            return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS
        
        @self.config.socketio.on('edit_message')
        def handle_edit_message(data):
            message_id = data['message_id']
            new_message = data['new_message']
            room = data['room']
            username = session['username']
            
            if self.message_manager.edit_message(message_id, new_message, username):
                emit('message_edited', {'message_id': message_id, 'new_message': new_message}, room=room)
            else:
                emit('edit_error', {'error': 'You can only edit your own messages'})

        @self.config.app.route('/get_group_chat_history/<room_id>')
        def get_group_chat_history(room_id):
            if 'username' not in session:
                return jsonify([])
            chat_history = self.message_manager.get_chat_history(room_id)
            return jsonify(chat_history)

    def setup_socketio(self):
        @self.config.socketio.on('send_friend_request')
        def handle_friend_request(data):
            sender = session['username']
            recipient = data['recipient']
            
            if sender == recipient:
                emit('friend_request_response', {'success': False, 'error': 'Cannot send friend request to yourself'})
                return
            
            if not self.db.users.find_one({'username': recipient}):
                emit('friend_request_response', {'success': False, 'error': 'User not found'})
                return
            
            if self.friend_request_manager.send_request(sender, recipient):
                emit('friend_request_response', {'success': True})
                emit('new_friend_request', {'sender': sender}, room=recipient)
            else:
                emit('friend_request_response', {'success': False, 'error': 'Friend request already sent'})

        @self.config.socketio.on('accept_friend_request')
        def handle_accept_friend_request(data):
            recipient = session['username']
            sender = data['sender']
            
            self.friend_request_manager.accept_request(sender, recipient)
            
            emit('friend_request_accepted', {'friend': sender})
            emit('friend_request_accepted', {'friend': recipient}, room=sender)

        @self.config.app.route('/friends')
        def friends():
            if 'username' not in session:
                return redirect('/')
            return render_template('friends.html', username=session['username'])
        
        @self.config.socketio.on('join_rooms')
        def on_join_rooms():
            username = session['username']
            for friend in self.user_manager.get_friends(username):
                room = '-'.join(sorted([username, friend]))
                join_room(room)
            emit('rooms_joined')

        @self.config.socketio.on('get_friends')
        def handle_get_friends():
            username = session['username']
            friend_list = self.user_manager.get_friends(username)
            emit('friends_list', {'friends': friend_list})

        @self.config.socketio.on('get_friend_requests')
        def handle_get_friend_requests():
            username = session['username']
            requests_list = self.friend_request_manager.get_pending_requests(username)
            emit('friend_requests_list', {'requests': requests_list})

        @self.config.socketio.on('join')
        def on_join(data):
            username = data['username']
            room = data['room']
            join_room(room)

        @self.config.socketio.on('leave')
        def on_leave(data):
            username = data['username']
            room = data['room']
            leave_room(room)

        @self.config.socketio.on('create_group_chat')
        def handle_create_group_chat(data):
            members = data['members']
            name = data['name']
            room_id = f"group_{secrets.token_hex(8)}"
            self.group_chats[room_id] = {
                'name': name,
                'members': members
            }
            for member in members:
                emit('group_chat_created', {
                    'roomId': room_id,
                    'name': name,
                    'members': members
                }, room=member)

        @self.config.socketio.on('message')
        def handle_message(data):
            sender = data['sender']
            room = data['room']
            message = data['message']
            recipient = data['recipient'] if 'recipient' in data else None
            reply_to = data.get('reply_to')
            image_filename = data.get('image_filename')
            
            message_id = self.message_manager.save_message(sender, recipient, message, room, reply_to, image_filename)
            
            emit_data = {
                'id': message_id,
                'sender': sender,
                'message': message,
                'reply_to': reply_to,
                'image_filename': image_filename,
                'deleted': False
            }
            
            if room.startswith('group_'):
                group_chat = self.group_chats.get(room)
                if group_chat:
                    for member in group_chat['members']:
                        emit('message', emit_data, room=member)
            else:
                emit('message', emit_data, room=room)

        @self.config.socketio.on('delete_message')
        def handle_delete_message(data):
            message_id = data['message_id']
            username = session['username']
            room = data['room']
            
            if self.message_manager.delete_message(message_id, username):
                emit('message_deleted', {'message_id': message_id}, room=room)
            else:
                emit('delete_error', {'error': 'You can only delete your own messages'})

        @self.config.socketio.on('add_reaction')
        def handle_add_reaction(data):
            message_id = data['message_id']
            emoji = data['emoji']
            username = session['username']
            room = data['room']
            
            reaction_counts = self.message_manager.add_reaction(message_id, emoji, username)
            if reaction_counts:
                emit('reaction_updated', {'message_id': message_id, 'reactions': reaction_counts}, room=room)

        
        @self.config.socketio.on('connect')
        def handle_connect():
            username = session.get('username')
            if username:
                self.online_users.add(username)
                emit('user_status', {'username': username, 'status': 'online'}, broadcast=True)
                
                # Send user's group chats
                user_group_chats = [
                    {'roomId': room_id, 'name': chat['name'], 'members': chat['members']}
                    for room_id, chat in self.group_chats.items()
                    if username in chat['members']
                ]
                emit('user_group_chats', {'group_chats': user_group_chats})

        @self.config.socketio.on('disconnect')
        def handle_disconnect():
            username = session.get('username')
            if username:
                self.online_users.remove(username)
                emit('user_status', {'username': username, 'status': 'offline'}, broadcast=True)

        @self.config.socketio.on('get_online_status')
        def handle_get_online_status(data):
            username = data['username']
            status = 'online' if username in self.online_users else 'offline'
            emit('user_status', {'username': username, 'status': status})

    def run(self):
        self.config.socketio.run(self.config.app, debug=True)
        
chat_app = ChatApp()
app = chat_app.config.app

if __name__ == '__main__':
    chat_app.run()
