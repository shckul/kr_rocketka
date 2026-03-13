const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.static(__dirname));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

let gameState = 'WAIT';
let multiplier = 1.00;
let crashPoint = 0;
let startTime = 0;
let history = [];
let players = {}; // Список активных игроков и их ставок

function startCycle() {
    gameState = 'WAIT';
    multiplier = 1.00;
    // Очищаем ставки предыдущего раунда
    for (let id in players) {
        players[id].betPlaced = false;
        players[id].cashedOut = false;
    }
    
    io.emit('gameState', { state: 'WAIT', history });

    setTimeout(() => {
        gameState = 'FLY';
        startTime = Date.now();
        crashPoint = (100 / (Math.random() * 99 + 1)) * 0.98;
        io.emit('gameState', { state: 'FLY', startTime });

        const gameLoop = setInterval(() => {
            multiplier = Math.pow(1.00045, Date.now() - startTime);
            
            if (multiplier >= crashPoint) {
                clearInterval(gameLoop);
                gameState = 'CRASH';
                history.unshift(multiplier.toFixed(2));
                if(history.length > 15) history.pop();
                io.emit('gameState', { state: 'CRASH', multiplier: multiplier.toFixed(2), history });
                setTimeout(startCycle, 3000);
            } else {
                io.emit('tick', { multiplier: multiplier.toFixed(2) });
            }
        }, 100);
    }, 5000);
}

io.on('connection', (socket) => {
    socket.on('join', (data) => {
        players[socket.id] = { name: data.name, bet: 0, betPlaced: false, cashedOut: false };
    });

    socket.on('placeBet', (data) => {
        if(gameState === 'WAIT' && players[socket.id]) {
            players[socket.id].bet = data.bet;
            players[socket.id].betPlaced = true;
            io.emit('playerAction', { name: players[socket.id].name, bet: data.bet, type: 'bet' });
        }
    });

    socket.on('cashOut', () => {
        if(gameState === 'FLY' && players[socket.id] && players[socket.id].betPlaced && !players[socket.id].cashedOut) {
            players[socket.id].cashedOut = true;
            io.emit('playerAction', { 
                name: players[socket.id].name, 
                mult: multiplier.toFixed(2), 
                type: 'cashout' 
            });
        }
    });

    socket.on('disconnect', () => { delete players[socket.id]; });
});

startCycle();
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));