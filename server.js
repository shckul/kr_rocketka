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

function startCycle() {
    gameState = 'WAIT';
    multiplier = 1.00;
    let waitTimer = 5.0; // Время на ставки

    // Сброс состояния игроков перед новым раундом
    for (let id in players) {
        players[id].betPlaced = false;
        players[id].cashedOut = false;
    }

    io.emit('gameState', { state: 'WAIT', history });

    const waitInterval = setInterval(() => {
        waitTimer -= 0.1;
        // Отправляем тики таймера для экрана ожидания
        io.emit('tick', { timer: waitTimer.toFixed(2), multiplier: "1.00" });

        if (waitTimer <= 0) {
            clearInterval(waitInterval);
            launchRocket();
        }
    }, 100);
}

function launchRocket() {
    gameState = 'FLY';
    startTime = Date.now();
    // Генерация точки взрыва (математика казино)
    crashPoint = (100 / (Math.random() * 99 + 1)) * 0.97; 
    io.emit('gameState', { state: 'FLY', startTime });

    const gameLoop = setInterval(() => {
        // Формула роста множителя
        multiplier = Math.pow(1.00045, Date.now() - startTime);
        
        if (multiplier >= crashPoint) {
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
    
    setTimeout(startCycle, 3000); // Пауза 3 сек после взрыва
}

io.on('connection', (socket) => {
    // Регистрация игрока
    players[socket.id] = { name: "Guest", bet: 0, betPlaced: false, cashedOut: false };

    socket.on('join', (data) => {
        if(players[socket.id]) players[socket.id].name = data.name || "Guest";
    });

    socket.on('placeBet', (data) => {
        if(gameState === 'WAIT' && players[socket.id]) {
            players[socket.id].bet = parseFloat(data.bet);
            players[socket.id].betPlaced = true;
            // Рассылаем всем инфо о ставке для списка игроков
            io.emit('playerAction', { 
                name: players[socket.id].name, 
                bet: data.bet, 
                type: 'bet' 
            });
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

// Запуск бесконечного цикла игры
startCycle();

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
