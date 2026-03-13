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

// --- ЛОГИКА ИГРОВОГО ЦИКЛА ---

function startCycle() {
    gameState = 'WAIT';
    multiplier = 1.00;
    let waitTimer = 5.0; // Время на прием ставок

    // Сброс состояния игроков для нового раунда
    for (let id in players) {
        players[id].betPlaced = false;
        players[id].cashedOut = false;
        players[id].currentBet = 0;
    }

    io.emit('gameState', { state: 'WAIT', history });

    const waitInterval = setInterval(() => {
        waitTimer -= 0.1;
        io.emit('tick', { timer: waitTimer.toFixed(1), multiplier: "1.00" });

        if (waitTimer <= 0) {
            clearInterval(waitInterval);
            launchRocket();
        }
    }, 100);
}

function launchRocket() {
    gameState = 'FLY';
    startTime = Date.now();
    
    // Математика Crash (House Edge 3%)
    crashPoint = (100 / (Math.random() * 99 + 1)) * 0.97; 
    
    io.emit('gameState', { state: 'FLY', startTime });

    const gameLoop = setInterval(() => {
        const elapsed = (Date.now() - startTime) / 1000;
        
        // НОВАЯ ПЛАВНАЯ ФОРМУЛА РОСТА
        // Примерно 2x через 10 сек, 10x через 30 сек. Игроки успеют нажать кнопку!
        multiplier = Math.pow(Math.E, 0.065 * elapsed);
        
        if (multiplier >= crashPoint) {
            multiplier = crashPoint; 
            clearInterval(gameLoop);
            doCrash();
        } else {
            io.emit('tick', { multiplier: multiplier.toFixed(2) });
        }
    }, 100);
}

function doCrash() {
    gameState = 'CRASH';
    history.unshift(parseFloat(multiplier.toFixed(2)));
    if(history.length > 15) history.pop();
    
    io.emit('gameState', { 
        state: 'CRASH', 
        multiplier: multiplier.toFixed(2), 
        history 
    });
    
    setTimeout(startCycle, 3000); // Пауза после взрыва
}

// --- СТАВКИ И БАЛАНС ---

io.on('connection', (socket) => {
    // Выдаем 1000 монет при входе
    players[socket.id] = { 
        name: "Guest", 
        balance: 1000.00, 
        currentBet: 0, 
        betPlaced: false, 
        cashedOut: false 
    };

    // СРАЗУ отправляем баланс, чтобы на экране не было 0.00
    socket.emit('updateBalance', { balance: players[socket.id].balance });

    socket.on('join', (data) => {
        if(players[socket.id]) players[socket.id].name = data.name || "Guest";
    });

    socket.on('placeBet', (data) => {
        const player = players[socket.id];
        const betAmount = parseFloat(data.bet);

        if(gameState === 'WAIT' && player && !player.betPlaced) {
            if (betAmount > 0 && player.balance >= betAmount) {
                player.balance -= betAmount;
                player.currentBet = betAmount;
                player.betPlaced = true;

                socket.emit('updateBalance', { balance: player.balance });
                
                io.emit('playerAction', { 
                    name: player.name, 
                    bet: betAmount, 
                    type: 'bet' 
                });
            } else {
                socket.emit('errorMsg', { text: "Недостаточно средств!" });
            }
        }
    });

    socket.on('cashOut', () => {
        const player = players[socket.id];
        if(gameState === 'FLY' && player && player.betPlaced && !player.cashedOut) {
            const winAmount = player.currentBet * multiplier;
            player.balance += winAmount;
            player.cashedOut = true;

            socket.emit('updateBalance', { balance: player.balance });
            
            io.emit('playerAction', { 
                name: player.name, 
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
