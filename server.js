const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const { MongoClient } = require('mongodb');
const bcrypt = require('bcryptjs');

const app = express();
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST'],
    credentials: true
}));

const server = http.createServer(app);
const wss = new WebSocket.Server({ 
    server,
    verifyClient: (info) => {
        // Accept connections from any origin
        return true;
    },
    clientTracking: true
});

// Add heartbeat to keep connections alive
function heartbeat() {
    this.isAlive = true;
}

wss.on('connection', (ws) => {
    ws.isAlive = true;
    ws.on('pong', heartbeat);
});

const interval = setInterval(() => {
    wss.clients.forEach((ws) => {
        if (ws.isAlive === false) return ws.terminate();
        ws.isAlive = false;
        ws.ping(() => {});
    });
}, 30000);

wss.on('close', () => {
    clearInterval(interval);
});

// MongoDB connection
const uri = process.env.MONGODB_URI || "mongodb+srv://ANTI-META:d1G1z6j5S7Fr8LKm@wearechat.5owda.mongodb.net/?retryWrites=true";
const client = new MongoClient(uri);

// Store connected clients with their usernames
const clients = new Map();

// Connect to MongoDB
async function connectDB() {
    try {
        await client.connect();
        // Test the connection by accessing the database
        await client.db("wearemeta").command({ ping: 1 });
        console.log("Successfully connected to MongoDB");
        
        // Create indexes for better performance
        const usersCollection = client.db("wearemeta").collection("users");
        await usersCollection.createIndex({ username: 1 }, { unique: true });
        
    } catch (error) {
        console.error("MongoDB connection error:", error);
        // Exit if we can't connect to the database
        process.exit(1);
    }
}

// Connect to MongoDB and handle process termination
connectDB().catch(console.error);

process.on('SIGINT', async () => {
    try {
        await client.close();
        console.log('MongoDB connection closed');
        process.exit(0);
    } catch (error) {
        console.error('Error during shutdown:', error);
        process.exit(1);
    }
});

// Username validation
function isValidUsername(username) {
    return typeof username === 'string' && 
           username.length >= 3 && 
           username.length <= 20 && 
           /^[a-zA-Z0-9_-]+$/.test(username);
}

// Password validation
function isValidPassword(password) {
    return typeof password === 'string' && 
           password.length >= 6;
}

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

async function handleRegistration(ws, data) {
    const { username, password } = data;
    
    // Validate input
    if (!isValidUsername(username)) {
        ws.send(JSON.stringify({
            type: 'error',
            message: 'Invalid username. Use 3-20 characters, only letters, numbers, underscore and dash.'
        }));
        return;
    }

    if (!isValidPassword(password)) {
        ws.send(JSON.stringify({
            type: 'error',
            message: 'Password must be at least 6 characters long'
        }));
        return;
    }

    try {
        // Check if username exists
        const usersCollection = client.db("wearemeta").collection("users");
        const existingUser = await usersCollection.findOne({ username });
        
        if (existingUser) {
            ws.send(JSON.stringify({
                type: 'error',
                message: 'Username already exists'
            }));
            return;
        }

        // Hash password and save user
        const hashedPassword = await bcrypt.hash(password, 10);
        await usersCollection.insertOne({
            username,
            password: hashedPassword,
            createdAt: new Date()
        });

        ws.send(JSON.stringify({
            type: 'registration_success',
            message: 'Registration successful'
        }));
    } catch (error) {
        console.error('Registration error:', error);
        ws.send(JSON.stringify({
            type: 'error',
            message: 'Registration failed. Please try again.'
        }));
    }
}

async function handleLogin(ws, data) {
    const { username, password } = data;
    
    try {
        // Get user from database
        const usersCollection = client.db("wearemeta").collection("users");
        const user = await usersCollection.findOne({ username });
        
        // Check if user exists and password matches
        if (!user || !(await bcrypt.compare(password, user.password))) {
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
    } catch (error) {
        console.error('Login error:', error);
        ws.send(JSON.stringify({
            type: 'error',
            message: 'Login failed. Please try again.'
        }));
    }
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
