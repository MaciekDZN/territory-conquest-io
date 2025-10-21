const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Game Configuration
const CONFIG = {
    MAP_SIZE: { width: 50, height: 50 },
    TILE_SIZE: 20,
    PLAYER_SIZE: 18,
    BASE_SPEED: 4,
    BOOST_MULTIPLIER: 2,
    PROJECTILE_SPEED: 12,
    SHOT_COST: 5,
    BOOST_COST: 1,
    GAME_DURATION: 300000, // 5 minutes in milliseconds
    MAX_PLAYERS_PER_ROOM: 20,
    MIN_PLAYERS_TO_START: 2,
    TICK_RATE: 20, // Server updates per second
    BROADCAST_INTERVAL: 50 // Broadcast to clients every 50ms
};

// Game State
const gameRooms = new Map();
const playerSockets = new Map();

// Room Class
class GameRoom {
    constructor(id) {
        this.id = id;
        this.players = new Map();
        this.projectiles = [];
        this.gameState = 'lobby'; // 'lobby', 'playing', 'finished'
        this.gameStartTime = null;
        this.lastUpdate = Date.now();
        this.tickInterval = null;
        this.broadcastInterval = null;
    }

    addPlayer(socket, playerData) {
        if (this.players.size >= CONFIG.MAX_PLAYERS_PER_ROOM) {
            return false;
        }

        const player = {
            id: socket.id,
            socket: socket,
            name: playerData.name,
            color: playerData.color,
            x: this.generateStartPosition().x,
            y: this.generateStartPosition().y,
            gridX: 0,
            gridY: 0,
            speed: CONFIG.BASE_SPEED,
            territory: new Set(),
            trail: [],
            kills: 0,
            alive: true,
            boosting: false,
            lastShot: 0,
            input: { dx: 0, dy: 0, shooting: false, boosting: false }
        };

        // Initialize starting territory (3x3 area)
        const startGridX = Math.floor(player.x / CONFIG.TILE_SIZE);
        const startGridY = Math.floor(player.y / CONFIG.TILE_SIZE);
        
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                player.territory.add(`${startGridX + dx},${startGridY + dy}`);
            }
        }

        player.gridX = startGridX;
        player.gridY = startGridY;

        this.players.set(socket.id, player);
        playerSockets.set(socket.id, this.id);

        // Setup socket event handlers
        this.setupPlayerEvents(socket);

        // Broadcast player joined
        this.broadcastToRoom('playerJoined', {
            player: this.serializePlayer(player),
            totalPlayers: this.players.size
        });

        // Send initial game state to new player
        socket.emit('gameState', this.getGameState());

        // Start game if enough players
        if (this.gameState === 'lobby' && this.players.size >= CONFIG.MIN_PLAYERS_TO_START) {
            setTimeout(() => this.startGame(), 3000); // 3 second countdown
        }

        return true;
    }

    removePlayer(socketId) {
        const player = this.players.get(socketId);
        if (player) {
            this.players.delete(socketId);
            playerSockets.delete(socketId);
            
            this.broadcastToRoom('playerLeft', {
                playerId: socketId,
                totalPlayers: this.players.size
            });

            // End game if not enough players
            if (this.gameState === 'playing' && this.players.size < CONFIG.MIN_PLAYERS_TO_START) {
                this.endGame();
            }
        }

        // Remove empty rooms
        if (this.players.size === 0) {
            this.cleanup();
            gameRooms.delete(this.id);
        }
    }

    setupPlayerEvents(socket) {
        socket.on('playerInput', (input) => {
            const player = this.players.get(socket.id);
            if (player && player.alive) {
                player.input = input;
            }
        });

        socket.on('playerShoot', () => {
            this.handlePlayerShoot(socket.id);
        });

        socket.on('disconnect', () => {
            this.removePlayer(socket.id);
        });
    }

    generateStartPosition() {
        let attempts = 0;
        let x, y;
        
        do {
            x = Math.floor(Math.random() * (CONFIG.MAP_SIZE.width - 6)) + 3;
            y = Math.floor(Math.random() * (CONFIG.MAP_SIZE.height - 6)) + 3;
            attempts++;
        } while (attempts < 100 && this.isPositionOccupied(x, y));
        
        return {
            x: x * CONFIG.TILE_SIZE + CONFIG.TILE_SIZE / 2,
            y: y * CONFIG.TILE_SIZE + CONFIG.TILE_SIZE / 2
        };
    }

    isPositionOccupied(gridX, gridY) {
        for (const player of this.players.values()) {
            const playerGridX = Math.floor(player.x / CONFIG.TILE_SIZE);
            const playerGridY = Math.floor(player.y / CONFIG.TILE_SIZE);
            
            if (Math.abs(playerGridX - gridX) < 5 && Math.abs(playerGridY - gridY) < 5) {
                return true;
            }
        }
        return false;
    }

    startGame() {
        if (this.gameState !== 'lobby') return;
        
        this.gameState = 'playing';
        this.gameStartTime = Date.now();
        
        // Start game loops
        this.tickInterval = setInterval(() => this.gameUpdate(), 1000 / CONFIG.TICK_RATE);
        this.broadcastInterval = setInterval(() => this.broadcastGameState(), CONFIG.BROADCAST_INTERVAL);
        
        this.broadcastToRoom('gameStarted', {
            duration: CONFIG.GAME_DURATION,
            startTime: this.gameStartTime
        });
    }

    gameUpdate() {
        if (this.gameState !== 'playing') return;
        
        const now = Date.now();
        const deltaTime = now - this.lastUpdate;
        this.lastUpdate = now;
        
        // Check game time limit
        if (now - this.gameStartTime >= CONFIG.GAME_DURATION) {
            this.endGame();
            return;
        }
        
        // Update players
        for (const player of this.players.values()) {
            if (player.alive) {
                this.updatePlayer(player, deltaTime);
            }
        }
        
        // Update projectiles
        this.updateProjectiles(deltaTime);
        
        // Check collisions
        this.checkCollisions();
        
        // Check win conditions
        this.checkWinConditions();
    }

    updatePlayer(player, deltaTime) {
        const input = player.input;
        
        // Apply movement
        let speed = CONFIG.BASE_SPEED;
        if (input.boosting && player.territory.size >= CONFIG.BOOST_COST) {
            speed *= CONFIG.BOOST_MULTIPLIER;
            
            // Consume territory for boost
            if (Math.random() < 0.02) { // Small chance each update
                const territories = Array.from(player.territory);
                if (territories.length > 9) { // Keep minimum territory
                    player.territory.delete(territories[0]);
                }
            }
        }
        
        // Normalize diagonal movement
        let { dx, dy } = input;
        if (dx !== 0 && dy !== 0) {
            const length = Math.sqrt(dx * dx + dy * dy);
            dx /= length;
            dy /= length;
        }
        
        // Update position
        player.x += dx * speed;
        player.y += dy * speed;
        
        // Keep player in bounds
        player.x = Math.max(CONFIG.TILE_SIZE/2, Math.min(CONFIG.MAP_SIZE.width * CONFIG.TILE_SIZE - CONFIG.TILE_SIZE/2, player.x));
        player.y = Math.max(CONFIG.TILE_SIZE/2, Math.min(CONFIG.MAP_SIZE.height * CONFIG.TILE_SIZE - CONFIG.TILE_SIZE/2, player.y));
        
        // Update grid position
        const newGridX = Math.floor(player.x / CONFIG.TILE_SIZE);
        const newGridY = Math.floor(player.y / CONFIG.TILE_SIZE);
        const gridKey = `${newGridX},${newGridY}`;
        
        // Check if in own territory
        const inOwnTerritory = player.territory.has(gridKey);
        
        if (inOwnTerritory) {
            // Player returned to territory - claim enclosed area
            if (player.trail.length > 0) {
                this.claimEnclosedArea(player);
                player.trail = [];
            }
        } else {
            // Add to trail if not already there
            if (player.trail.length === 0 || player.trail[player.trail.length - 1] !== gridKey) {
                player.trail.push(gridKey);
            }
        }
        
        player.gridX = newGridX;
        player.gridY = newGridY;
    }

    claimEnclosedArea(player) {
        // Add all trail positions to territory
        player.trail.forEach(pos => {
            player.territory.add(pos);
        });
        
        // Simple flood fill to find enclosed area
        const minX = Math.min(...player.trail.map(pos => parseInt(pos.split(',')[0])));
        const maxX = Math.max(...player.trail.map(pos => parseInt(pos.split(',')[0])));
        const minY = Math.min(...player.trail.map(pos => parseInt(pos.split(',')[1])));
        const maxY = Math.max(...player.trail.map(pos => parseInt(pos.split(',')[1])));
        
        // Claim rectangular area (simplified)
        for (let x = minX; x <= maxX; x++) {
            for (let y = minY; y <= maxY; y++) {
                const key = `${x},${y}`;
                player.territory.add(key);
            }
        }
    }

    handlePlayerShoot(playerId) {
        const player = this.players.get(playerId);
        if (!player || !player.alive) return;
        
        const now = Date.now();
        if (now - player.lastShot < 500) return; // Rate limit
        
        if (player.territory.size < CONFIG.SHOT_COST) return; // Not enough territory
        
        // Remove territory cost
        const territories = Array.from(player.territory);
        for (let i = 0; i < CONFIG.SHOT_COST && territories.length > 9; i++) {
            player.territory.delete(territories[i]);
        }
        
        // Determine shoot direction based on recent movement
        const input = player.input;
        let dx = 0, dy = -1; // Default: up
        
        if (Math.abs(input.dx) > Math.abs(input.dy)) {
            dx = input.dx > 0 ? 1 : -1;
            dy = 0;
        } else if (input.dy !== 0) {
            dx = 0;
            dy = input.dy > 0 ? 1 : -1;
        }
        
        // Create projectile
        const projectile = {
            id: `${playerId}_${now}`,
            x: player.x,
            y: player.y,
            dx: dx * CONFIG.PROJECTILE_SPEED,
            dy: dy * CONFIG.PROJECTILE_SPEED,
            owner: playerId,
            life: 3000 // 3 second lifespan
        };
        
        this.projectiles.push(projectile);
        player.lastShot = now;
        
        // Broadcast shot
        this.broadcastToRoom('projectileCreated', projectile);
    }

    updateProjectiles(deltaTime) {
        this.projectiles = this.projectiles.filter(projectile => {
            projectile.x += projectile.dx * (deltaTime / 16); // Normalize for 60fps equivalent
            projectile.y += projectile.dy * (deltaTime / 16);
            projectile.life -= deltaTime;
            
            // Remove if out of bounds or expired
            if (projectile.x < 0 || projectile.x > CONFIG.MAP_SIZE.width * CONFIG.TILE_SIZE ||
                projectile.y < 0 || projectile.y > CONFIG.MAP_SIZE.height * CONFIG.TILE_SIZE ||
                projectile.life <= 0) {
                return false;
            }
            
            // Check collision with players
            for (const target of this.players.values()) {
                if (target.alive && target.id !== projectile.owner) {
                    const distance = Math.sqrt(
                        Math.pow(projectile.x - target.x, 2) + 
                        Math.pow(projectile.y - target.y, 2)
                    );
                    
                    if (distance < CONFIG.PLAYER_SIZE) {
                        // Hit! Kill the target
                        this.killPlayer(target.id, projectile.owner);
                        return false; // Remove projectile
                    }
                }
            }
            
            return true;
        });
    }

    checkCollisions() {
        const alivePlayers = Array.from(this.players.values()).filter(p => p.alive);
        
        for (let i = 0; i < alivePlayers.length; i++) {
            for (let j = i + 1; j < alivePlayers.length; j++) {
                const player1 = alivePlayers[i];
                const player2 = alivePlayers[j];
                
                const player1GridKey = `${player1.gridX},${player1.gridY}`;
                const player2GridKey = `${player2.gridX},${player2.gridY}`;
                
                // Check if player1 hits player2's trail
                if (player2.trail.includes(player1GridKey)) {
                    this.killPlayer(player2.id, player1.id);
                }
                
                // Check if player2 hits player1's trail
                if (player1.trail.includes(player2GridKey)) {
                    this.killPlayer(player1.id, player2.id);
                }
            }
        }
    }

    killPlayer(victimId, killerId) {
        const victim = this.players.get(victimId);
        const killer = this.players.get(killerId);
        
        if (victim && victim.alive) {
            victim.alive = false;
            
            // Award kill to killer
            if (killer) {
                killer.kills++;
                
                // Transfer territory to killer
                victim.territory.forEach(tile => {
                    killer.territory.add(tile);
                });
            }
            
            // Broadcast death
            this.broadcastToRoom('playerKilled', {
                victim: victimId,
                killer: killerId
            });
            
            // Check if game should end
            const alivePlayers = Array.from(this.players.values()).filter(p => p.alive);
            if (alivePlayers.length <= 1) {
                setTimeout(() => this.endGame(), 2000);
            }
        }
    }

    checkWinConditions() {
        const alivePlayers = Array.from(this.players.values()).filter(p => p.alive);
        
        if (alivePlayers.length === 1) {
            // Last player standing wins
            this.endGame(alivePlayers[0]);
            return;
        }
        
        // Check domination victory
        const totalTiles = CONFIG.MAP_SIZE.width * CONFIG.MAP_SIZE.height;
        for (const player of alivePlayers) {
            const territoryPercent = (player.territory.size / totalTiles) * 100;
            if (territoryPercent >= 80) {
                this.endGame(player);
                return;
            }
        }
    }

    endGame(winner = null) {
        this.gameState = 'finished';
        
        // Clear intervals
        if (this.tickInterval) {
            clearInterval(this.tickInterval);
            this.tickInterval = null;
        }
        if (this.broadcastInterval) {
            clearInterval(this.broadcastInterval);
            this.broadcastInterval = null;
        }
        
        // Calculate final results
        const results = this.calculateResults();
        
        // Broadcast game end
        this.broadcastToRoom('gameEnded', {
            winner: winner ? winner.id : null,
            results: results,
            duration: Date.now() - this.gameStartTime
        });
        
        // Reset room to lobby after delay
        setTimeout(() => {
            this.resetToLobby();
        }, 10000);
    }

    calculateResults() {
        const totalTiles = CONFIG.MAP_SIZE.width * CONFIG.MAP_SIZE.height;
        
        return Array.from(this.players.values()).map(player => ({
            id: player.id,
            name: player.name,
            territoryPercent: ((player.territory.size / totalTiles) * 100).toFixed(1),
            kills: player.kills,
            alive: player.alive
        })).sort((a, b) => parseFloat(b.territoryPercent) - parseFloat(a.territoryPercent));
    }

    resetToLobby() {
        this.gameState = 'lobby';
        this.gameStartTime = null;
        this.projectiles = [];
        
        // Reset all players
        for (const player of this.players.values()) {
            const startPos = this.generateStartPosition();
            player.x = startPos.x;
            player.y = startPos.y;
            player.gridX = Math.floor(player.x / CONFIG.TILE_SIZE);
            player.gridY = Math.floor(player.y / CONFIG.TILE_SIZE);
            player.territory = new Set();
            player.trail = [];
            player.kills = 0;
            player.alive = true;
            player.boosting = false;
            player.lastShot = 0;
            
            // Reset starting territory
            for (let dx = -1; dx <= 1; dx++) {
                for (let dy = -1; dy <= 1; dy++) {
                    player.territory.add(`${player.gridX + dx},${player.gridY + dy}`);
                }
            }
        }
        
        this.broadcastToRoom('gameReset', {});
    }

    broadcastToRoom(event, data) {
        for (const player of this.players.values()) {
            player.socket.emit(event, data);
        }
    }

    broadcastGameState() {
        if (this.gameState !== 'playing') return;
        
        const gameState = this.getGameState();
        this.broadcastToRoom('gameStateUpdate', gameState);
    }

    getGameState() {
        return {
            players: Array.from(this.players.values()).map(p => this.serializePlayer(p)),
            projectiles: this.projectiles.map(p => ({ ...p })),
            gameState: this.gameState,
            gameTime: this.gameStartTime ? Date.now() - this.gameStartTime : 0
        };
    }

    serializePlayer(player) {
        return {
            id: player.id,
            name: player.name,
            color: player.color,
            x: player.x,
            y: player.y,
            gridX: player.gridX,
            gridY: player.gridY,
            territory: Array.from(player.territory),
            trail: [...player.trail],
            kills: player.kills,
            alive: player.alive,
            boosting: player.boosting
        };
    }

    cleanup() {
        if (this.tickInterval) {
            clearInterval(this.tickInterval);
        }
        if (this.broadcastInterval) {
            clearInterval(this.broadcastInterval);
        }
    }
}

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Socket.io connection handling
io.on('connection', (socket) => {
    console.log(`Player connected: ${socket.id}`);

    socket.on('joinGame', (playerData) => {
        // Find or create a room
        let room = null;
        
        // Look for an available room
        for (const gameRoom of gameRooms.values()) {
            if (gameRoom.gameState === 'lobby' && gameRoom.players.size < CONFIG.MAX_PLAYERS_PER_ROOM) {
                room = gameRoom;
                break;
            }
        }
        
        // Create new room if none available
        if (!room) {
            const roomId = `room_${Date.now()}`;
            room = new GameRoom(roomId);
            gameRooms.set(roomId, room);
        }
        
        // Add player to room
        const success = room.addPlayer(socket, playerData);
        
        if (success) {
            socket.emit('joinedGame', {
                roomId: room.id,
                playerId: socket.id
            });
        } else {
            socket.emit('joinFailed', { reason: 'Room is full' });
        }
    });

    socket.on('disconnect', () => {
        console.log(`Player disconnected: ${socket.id}`);
        
        const roomId = playerSockets.get(socket.id);
        if (roomId) {
            const room = gameRooms.get(roomId);
            if (room) {
                room.removePlayer(socket.id);
            }
        }
    });
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Game server running on port ${PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('Server shutting down...');
    
    // Cleanup all rooms
    for (const room of gameRooms.values()) {
        room.cleanup();
    }
    
    server.close(() => {
        console.log('Server shutdown complete');
        process.exit(0);
    });
});