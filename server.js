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
        const player = players[socket.id];
        // Важно: в твоем index.html поле называется bet, а не amount
        const betAmount = parseFloat(data.bet); 

        if (gameState === 'WAIT' && player && !player.betPlaced) {
            // ПРОВЕРКА: Число ли это и хватает ли денег?
            if (!isNaN(betAmount) && betAmount > 0 && player.balance >= betAmount) {
                player.balance -= betAmount; // Списываем деньги сразу!
                player.bet = betAmount;
                player.betPlaced = true;

                // Отправляем игроку его НОВЫЙ баланс после списания
                socket.emit('updateBalance', { balance: player.balance });
                
                // Оповещаем всех в чате/списке
                io.emit('playerAction', { 
                    name: player.name, 
                    bet: betAmount, 
                    type: 'bet' 
                });
            } else {
                // Если денег нет — отправляем сигнал об ошибке
                socket.emit('errorMsg', { text: "Недостаточно средств или неверная сумма!" });
            }
        }
    });

    socket.on('cashOut', () => {
    const player = players[socket.id];
    // Проверяем: игра идет, игрок сделал ставку и еще не забирал деньги
    if(gameState === 'FLY' && player && player.betPlaced && !player.cashedOut) {
        
        // 1. Считаем выигрыш (ставка * текущий коэффициент)
        const winAmount = player.bet * multiplier;
        
        // 2. Начисляем деньги в кошелек на сервере
        player.balance += winAmount;
        player.cashedOut = true;

        // 3. СРАЗУ отправляем игроку его новый баланс
        socket.emit('updateBalance', { balance: player.balance });

        // 4. Оповещаем всех об успешном выходе
        io.emit('playerAction', { 
            name: player.name, 
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
