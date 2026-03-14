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
let players = {}; 

let forcedCrash = null; 
const ADMIN_PASSWORD = "admin777"; 

function startCycle() {
    gameState = 'WAIT';
    multiplier = 1.00;
    let waitTimer = 5.0;

    for (let id in players) {
        players[id].betPlaced = false;
        players[id].cashedOut = false;
        players[id].currentBet = 0;
    }

    io.emit('gameState', { state: 'WAIT', history });

    const waitInterval = setInterval(() => {
        waitTimer -= 0.1;
        io.emit('tick', { timer: waitTimer.toFixed(1) });
        if (waitTimer <= 0) {
            clearInterval(waitInterval);
            launchRocket();
        }
    }, 100);
}

function launchRocket() {
    gameState = 'FLY';
    startTime = Date.now();
    
    if (forcedCrash !== null) {
        crashPoint = forcedCrash;
        forcedCrash = null; 
    } else {
        crashPoint = (99 / (Math.random() * 98 + 1)) * 0.97;
        if (crashPoint < 1.01) crashPoint = 1.10;
    }
    
    io.emit('gameState', { state: 'FLY', startTime });

    const gameLoop = setInterval(() => {
        const elapsed = (Date.now() - startTime) / 1000;
        multiplier = Math.pow(Math.E, 0.12 * elapsed); // Твоя скорость 0.12
        
        if (multiplier >= crashPoint) {
            multiplier = crashPoint; 
            clearInterval(gameLoop);
            doCrash();
        } else {
            io.emit('tick', { multiplier: multiplier.toFixed(2) });
        }
    }, 50); // Частота обновления 50мс для плавности сетки
}

function doCrash() {
    gameState = 'CRASH';
    history.unshift(parseFloat(multiplier.toFixed(2)));
    if(history.length > 15) history.pop();
    io.emit('gameState', { state: 'CRASH', multiplier: multiplier.toFixed(2), history });
    setTimeout(startCycle, 4000); // Пауза после краша
}

io.on('connection', (socket) => {
    players[socket.id] = { name: "Player_" + socket.id.substr(0,4), balance: 1000.00, currentBet: 0, betPlaced: false, cashedOut: false };
    socket.emit('updateBalance', { balance: players[socket.id].balance });

    socket.on('join', (data) => { if(players[socket.id] && data.name) players[socket.id].name = data.name; });

    socket.on('adminCommand', (data) => {
        if (data.password !== ADMIN_PASSWORD) return;
        if (data.action === 'setNextCrash') forcedCrash = parseFloat(data.value);
        if (data.action === 'addBalance') {
            for (let id in players) {
                if (players[id].name === data.targetName) {
                    players[id].balance += parseFloat(data.amount);
                    io.to(id).emit('updateBalance', { balance: players[id].balance });
                }
            }
        }
    });

    socket.on('placeBet', (data) => {
        const p = players[socket.id];
        if(gameState === 'WAIT' && p && !p.betPlaced && p.balance >= data.bet) {
            p.balance -= data.bet; p.currentBet = data.bet; p.betPlaced = true;
            socket.emit('updateBalance', { balance: p.balance });
            io.emit('playerAction', { name: p.name, bet: data.bet, type: 'bet' });
        }
    });

    socket.on('cashOut', () => {
        const p = players[socket.id];
        if(gameState === 'FLY' && p && p.betPlaced && !p.cashedOut) {
            const win = p.currentBet * multiplier;
            p.balance += win; p.cashedOut = true;
            socket.emit('updateBalance', { balance: p.balance });
            io.emit('playerAction', { name: p.name, mult: multiplier.toFixed(2), type: 'cashout' });
        }
    });

    socket.on('disconnect', () => { delete players[socket.id]; });
});

server.listen(process.env.PORT || 3000, () => {
    console.log('Server is running');
    startCycle();
});
