const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);
const wss = new WebSocket.Server({ 
    server,
    verifyClient: () => true
});

// Store registered users and their passwords
const users = new Map();
// Store connected clients with their usernames
const clients = new Map();

wss.on('connection', (ws) => {
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            
            switch(data.type) {
                case 'register':
                    handleRegistration(ws, data);
                    break;
                case 'login':
                    handleLogin(ws, data);
                    break;
                case 'message':
                    handleMessage(ws, data);
                    break;
                case 'join':
                    handleJoin(ws, data);
                    break;
            }
        } catch (error) {
            console.error('Error parsing message:', error);
        }
    });

    ws.on('close', () => {
        if (clients.has(ws)) {
            const username = clients.get(ws);
            clients.delete(ws);
            
            // Notify others that user has left
            broadcastToOthers(ws, {
                type: 'leave',
                username: username,
                message: 'has left the resistance'
            });
        }
    });
});

function handleRegistration(ws, data) {
    const { username, password } = data;
    if (users.has(username)) {
        ws.send(JSON.stringify({
            type: 'error',
            message: 'Username already exists'
        }));
        return;
    }
    
    users.set(username, password);
    ws.send(JSON.stringify({
        type: 'registration_success',
        message: 'Registration successful'
    }));
}

function handleLogin(ws, data) {
    const { username, password } = data;
    
    // Check if username exists and password matches
    if (!users.has(username) || users.get(username) !== password) {
        ws.send(JSON.stringify({
            type: 'error',
            message: 'Invalid username or password'
        }));
        return;
    }
    
    // Check if user is already logged in
    for (const [client, clientUsername] of clients) {
        if (clientUsername === username) {
            ws.send(JSON.stringify({
                type: 'error',
                message: 'User already logged in'
            }));
            return;
        }
    }
    
    clients.set(ws, username);
    ws.send(JSON.stringify({
        type: 'login_success',
        username: username
    }));
    
    // Send join notification to others
    broadcastToOthers(ws, {
        type: 'join',
        username: username,
        message: 'has joined the resistance'
    });
}

function handleMessage(ws, data) {
    if (!clients.has(ws)) return;
    
    const username = clients.get(ws);
    const messageData = {
        type: 'message',
        username: username,
        message: data.message
    };
    
    // Send to all clients including sender
    broadcast(messageData);
}

function handleJoin(ws, data) {
    if (!clients.has(ws)) {
        clients.set(ws, data.username);
    }
}

function broadcast(data) {
    const message = JSON.stringify(data);
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    });
}

function broadcastToOthers(ws, data) {
    const message = JSON.stringify(data);
    wss.clients.forEach(client => {
        if (client !== ws && client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    });
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
