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
    let waitTimer = 5.0; // Время на ставки

    // Сброс состояния игроков перед новым раундом
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
    
    // Математика честного Crash (House Edge 3%)
    // Результат генерируется ЗАРАНЕЕ, как в настоящих казино
    crashPoint = (100 / (Math.random() * 99 + 1)) * 0.97; 
    
    io.emit('gameState', { state: 'FLY', startTime });

    const gameLoop = setInterval(() => {
        // Формула роста множителя (плавная экспонента)
        const elapsed = (Date.now() - startTime) / 1000;
        multiplier = Math.pow(Math.E, 0.06 * elapsed);
        
        if (multiplier >= crashPoint) {
            multiplier = crashPoint; // Фиксируем точный момент взрыва
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
    
    setTimeout(startCycle, 3000); // Пауза 3 сек перед новым раундом
}

// --- ЛОГИКА ПОДКЛЮЧЕНИЙ И СТАВОК ---

io.on('connection', (socket) => {
    // 1. Создаем игрока с начальным балансом 1000
    players[socket.id] = { 
        name: "Guest", 
        balance: 1000.00, 
        currentBet: 0, 
        betPlaced: false, 
        cashedOut: false 
    };

    // 2. СРАЗУ отправляем баланс игроку, чтобы на экране не было 0.00
    socket.emit('updateBalance', { balance: players[socket.id].balance });

    socket.on('join', (data) => {
        if(players[socket.id]) players[socket.id].name = data.name || "Guest";
    });

    // ОБРАБОТКА СТАВКИ
    socket.on('placeBet', (data) => {
        const player = players[socket.id];
        const betAmount = parseFloat(data.bet);

        if(gameState === 'WAIT' && player && !player.betPlaced) {
            // ПРОВЕРКА: хватает ли денег на балансе?
            if (betAmount > 0 && player.balance >= betAmount) {
                player.balance -= betAmount; // Списываем деньги
                player.currentBet = betAmount;
                player.betPlaced = true;

                // Подтверждаем списание игроку
                socket.emit('updateBalance', { balance: player.balance });
                
                // Показываем всем остальным, что игрок зашел в игру
                io.emit('playerAction', { 
                    name: player.name, 
                    bet: betAmount, 
                    type: 'bet' 
                });
            } else {
                // Если денег нет — шлем ошибку
                socket.emit('errorMsg', { text: "Недостаточно средств!" });
            }
        }
    });

    // ВЫВОД ДЕНЕГ (CASHOUT)
    socket.on('cashOut', () => {
        const player = players[socket.id];
        if(gameState === 'FLY' && player && player.betPlaced && !player.cashedOut) {
            const winAmount = player.currentBet * multiplier;
            player.balance += winAmount; // Начисляем выигрыш
            player.cashedOut = true;

            // Отправляем новый баланс с выигрышем
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

// Запуск бесконечного цикла
startCycle();

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
