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
    GAME_DURATION: 300,
    COINS_PER_PERCENT: 1
};

// Game State
let gameState = {
    currentScreen: 'auth',
    socket: null,
    player: null,
    players: new Map(),
    projectiles: [],
    gameStartTime: 0,
    lastUpdateTime: 0,
    keys: {},
    mobile: {
        joystick: { active: false, x: 0, y: 0 },
        shooting: false,
        boosting: false
    }
};

// User Data (in-memory storage instead of localStorage)
let userData = {
    username: '',
    coins: 0,
    currentSkin: 0,
    ownedSkins: [0, 1], // Red and Blue are free
    stats: {
        gamesPlayed: 0,
        totalKills: 0,
        bestTerritory: 0
    },
    isGuest: false
};

// Default skins data
const SKINS = [
    { name: 'Red', color: '#FF0000', price: 0 },
    { name: 'Blue', color: '#0000FF', price: 0 },
    { name: 'Green', color: '#00FF00', price: 100 },
    { name: 'Yellow', color: '#FFFF00', price: 100 },
    { name: 'Purple', color: '#800080', price: 100 },
    { name: 'Orange', color: '#FFA500', price: 100 },
    { name: 'Pink', color: '#FFC0CB', price: 100 },
    { name: 'Cyan', color: '#00FFFF', price: 100 },
    { name: 'Lime', color: '#32CD32', price: 100 },
    { name: 'Magenta', color: '#FF00FF', price: 100 },
    { name: 'Navy', color: '#000080', price: 100 },
    { name: 'Teal', color: '#008080', price: 100 }
];

// Rankings data (in-memory)
let rankings = [
    { username: 'ProPlayer', bestTerritory: 85.2, totalKills: 127, gamesPlayed: 45 },
    { username: 'TerritoryKing', bestTerritory: 78.9, totalKills: 98, gamesPlayed: 32 },
    { username: 'Conquerer', bestTerritory: 72.1, totalKills: 156, gamesPlayed: 67 }
];

// Canvas and rendering
let canvas, ctx;
let camera = { x: 0, y: 0 };

// Initialize game
function initGame() {
    canvas = document.getElementById('gameCanvas');
    ctx = canvas.getContext('2d');
    
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    
    setupEventListeners();
    initMobileControls();
    showScreen('auth');
    
    // Load user data from "storage" (demo data)
    loadUserData();
    
    // Start game loop
    requestAnimationFrame(gameLoop);
}

function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight - 100; // Account for HUD
}

function setupEventListeners() {
    // Keyboard events
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('keyup', handleKeyUp);
    
    // Prevent context menu on canvas
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
}

function handleKeyDown(e) {
    gameState.keys[e.code] = true;
    
    if (gameState.currentScreen === 'game') {
        switch(e.code) {
            case 'Space':
                e.preventDefault();
                shoot();
                break;
        }
    }
}

function handleKeyUp(e) {
    gameState.keys[e.code] = false;
}

function initMobileControls() {
    const joystick = document.getElementById('joystick');
    const joystickKnob = document.getElementById('joystickKnob');
    const shootBtn = document.getElementById('shootBtn');
    const boostBtn = document.getElementById('boostBtn');
    
    // Joystick controls
    let joystickRect;
    
    function updateJoystickRect() {
        joystickRect = joystick.getBoundingClientRect();
    }
    
    joystick.addEventListener('touchstart', (e) => {
        e.preventDefault();
        updateJoystickRect();
        gameState.mobile.joystick.active = true;
        handleJoystickMove(e.touches[0]);
    });
    
    joystick.addEventListener('touchmove', (e) => {
        e.preventDefault();
        if (gameState.mobile.joystick.active) {
            handleJoystickMove(e.touches[0]);
        }
    });
    
    joystick.addEventListener('touchend', (e) => {
        e.preventDefault();
        gameState.mobile.joystick.active = false;
        gameState.mobile.joystick.x = 0;
        gameState.mobile.joystick.y = 0;
        joystickKnob.style.transform = 'translate(-50%, -50%)';
    });
    
    function handleJoystickMove(touch) {
        const centerX = joystickRect.left + joystickRect.width / 2;
        const centerY = joystickRect.top + joystickRect.height / 2;
        
        let deltaX = touch.clientX - centerX;
        let deltaY = touch.clientY - centerY;
        
        const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
        const maxDistance = joystickRect.width / 2 - 20;
        
        if (distance > maxDistance) {
            deltaX = (deltaX / distance) * maxDistance;
            deltaY = (deltaY / distance) * maxDistance;
        }
        
        gameState.mobile.joystick.x = deltaX / maxDistance;
        gameState.mobile.joystick.y = deltaY / maxDistance;
        
        joystickKnob.style.transform = `translate(${deltaX - 50}%, ${deltaY - 50}%)`;
    }
    
    // Action buttons
    shootBtn.addEventListener('touchstart', (e) => {
        e.preventDefault();
        shoot();
    });
    
    boostBtn.addEventListener('touchstart', (e) => {
        e.preventDefault();
        gameState.mobile.boosting = true;
    });
    
    boostBtn.addEventListener('touchend', (e) => {
        e.preventDefault();
        gameState.mobile.boosting = false;
    });
}

// Authentication functions
function switchAuthTab(tab) {
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.auth-form').forEach(form => form.classList.remove('active'));
    
    document.querySelector(`[onclick="switchAuthTab('${tab}')"]`).classList.add('active');
    document.getElementById(tab + 'Form').classList.add('active');
}

function handleLogin() {
    const username = document.getElementById('loginUsername').value;
    const password = document.getElementById('loginPassword').value;
    
    if (username.length < 3) {
        alert('Username must be at least 3 characters');
        return;
    }
    
    if (password.length < 6) {
        alert('Password must be at least 6 characters');
        return;
    }
    
    // Simulate login (in real app, would validate against server)
    userData.username = username;
    userData.isGuest = false;
    
    loginUser();
}

function handleRegister() {
    const username = document.getElementById('regUsername').value;
    const password = document.getElementById('regPassword').value;
    
    if (username.length < 3) {
        alert('Username must be at least 3 characters');
        return;
    }
    
    if (password.length < 6) {
        alert('Password must be at least 6 characters');
        return;
    }
    
    // Simulate registration
    userData.username = username;
    userData.isGuest = false;
    userData.coins = 50; // Welcome bonus
    
    loginUser();
}

function playAsGuest() {
    userData.username = 'Guest' + Math.floor(Math.random() * 10000);
    userData.isGuest = true;
    userData.coins = 0;
    
    loginUser();
}

function loginUser() {
    document.getElementById('authModal').classList.add('hidden');
    updatePlayerInfo();
    showScreen('lobby');
}

function logout() {
    userData = {
        username: '',
        coins: 0,
        currentSkin: 0,
        ownedSkins: [0, 1],
        stats: { gamesPlayed: 0, totalKills: 0, bestTerritory: 0 },
        isGuest: false
    };
    
    showScreen('auth');
    document.getElementById('authModal').classList.remove('hidden');
}

function updatePlayerInfo() {
    document.getElementById('playerName').textContent = userData.username;
    document.getElementById('lobbyCoins').textContent = userData.coins;
    document.getElementById('playerCoins').textContent = userData.coins;
    
    // Show/hide logout button for guests
    document.getElementById('logoutBtn').style.display = userData.isGuest ? 'none' : 'block';
}

// Screen management
function showScreen(screenName) {
    document.querySelectorAll('.screen').forEach(screen => {
        screen.classList.remove('active');
    });
    
    const targetScreen = document.getElementById(screenName === 'auth' ? 'lobby' : screenName + 'Screen');
    if (targetScreen) {
        targetScreen.classList.add('active');
    }
    
    gameState.currentScreen = screenName;
}

// Shop functions
function openShop() {
    updateShopDisplay();
    document.getElementById('shopModal').classList.remove('hidden');
}

function closeShop() {
    document.getElementById('shopModal').classList.add('hidden');
}

function updateShopDisplay() {
    const skinsGrid = document.getElementById('skinsGrid');
    skinsGrid.innerHTML = '';
    
    SKINS.forEach((skin, index) => {
        const skinItem = document.createElement('div');
        skinItem.className = 'skin-item';
        
        const isOwned = userData.ownedSkins.includes(index);
        const isCurrent = userData.currentSkin === index;
        
        skinItem.innerHTML = `
            <div class="skin-preview" style="background: ${skin.color}"></div>
            <div class="skin-name">${skin.name}</div>
            ${isCurrent ? '<button class="skin-btn current">Current</button>' :
              isOwned ? `<button class="skin-btn select" onclick="selectSkin(${index})">Select</button>` :
              `<button class="skin-btn buy" onclick="buySkin(${index})">Buy - ${skin.price} coins</button>`}
        `;
        
        skinsGrid.appendChild(skinItem);
    });
}

function selectSkin(skinIndex) {
    userData.currentSkin = skinIndex;
    updateShopDisplay();
    saveUserData();
}

function buySkin(skinIndex) {
    const skin = SKINS[skinIndex];
    
    if (userData.coins >= skin.price) {
        userData.coins -= skin.price;
        userData.ownedSkins.push(skinIndex);
        userData.currentSkin = skinIndex;
        
        updatePlayerInfo();
        updateShopDisplay();
        saveUserData();
    } else {
        alert('Not enough coins!');
    }
}

// Rankings functions
function openRankings() {
    updateRankingsDisplay();
    document.getElementById('rankingsModal').classList.remove('hidden');
}

function closeRankings() {
    document.getElementById('rankingsModal').classList.add('hidden');
}

function updateRankingsDisplay() {
    const tbody = document.getElementById('rankingsBody');
    tbody.innerHTML = '';
    
    rankings.sort((a, b) => b.bestTerritory - a.bestTerritory);
    
    rankings.forEach((player, index) => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${index + 1}</td>
            <td>${player.username}</td>
            <td>${player.bestTerritory.toFixed(1)}%</td>
            <td>${player.totalKills}</td>
            <td>${player.gamesPlayed}</td>
        `;
        tbody.appendChild(row);
    });
}

// Game functions
function startGame() {
    // Simulate joining a game room
    gameState.player = createPlayer(userData.username, SKINS[userData.currentSkin].color);
    gameState.gameStartTime = Date.now();
    
    // Add some AI players for demo
    addAIPlayers();
    
    showScreen('game');
    resetGameState();
}

function createPlayer(name, color) {
    const startX = Math.floor(Math.random() * (CONFIG.MAP_SIZE.width - 6)) + 3;
    const startY = Math.floor(Math.random() * (CONFIG.MAP_SIZE.height - 6)) + 3;
    
    return {
        id: Date.now() + Math.random(),
        name: name,
        color: color,
        x: startX * CONFIG.TILE_SIZE + CONFIG.TILE_SIZE / 2,
        y: startY * CONFIG.TILE_SIZE + CONFIG.TILE_SIZE / 2,
        gridX: startX,
        gridY: startY,
        speed: CONFIG.BASE_SPEED,
        territory: new Set(),
        trail: [],
        kills: 0,
        alive: true,
        boosting: false,
        lastShot: 0
    };
}

function addAIPlayers() {
    for (let i = 0; i < 5; i++) {
        const aiPlayer = createPlayer(`Bot${i + 1}`, SKINS[Math.floor(Math.random() * SKINS.length)].color);
        gameState.players.set(aiPlayer.id, aiPlayer);
    }
}

function resetGameState() {
    gameState.projectiles = [];
    
    // Initialize player territory (3x3 starting area)
    if (gameState.player) {
        const startGridX = Math.floor(gameState.player.x / CONFIG.TILE_SIZE);
        const startGridY = Math.floor(gameState.player.y / CONFIG.TILE_SIZE);
        
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                gameState.player.territory.add(`${startGridX + dx},${startGridY + dy}`);
            }
        }
    }
    
    // Initialize AI territories
    gameState.players.forEach(player => {
        const startGridX = Math.floor(player.x / CONFIG.TILE_SIZE);
        const startGridY = Math.floor(player.y / CONFIG.TILE_SIZE);
        
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                player.territory.add(`${startGridX + dx},${startGridY + dy}`);
            }
        }
    });
}

function updatePlayer() {
    if (!gameState.player || !gameState.player.alive) return;
    
    let dx = 0, dy = 0;
    
    // Get input from keyboard or mobile
    if (window.innerWidth > 768) {
        // Desktop controls
        if (gameState.keys['KeyW'] || gameState.keys['ArrowUp']) dy = -1;
        if (gameState.keys['KeyS'] || gameState.keys['ArrowDown']) dy = 1;
        if (gameState.keys['KeyA'] || gameState.keys['ArrowLeft']) dx = -1;
        if (gameState.keys['KeyD'] || gameState.keys['ArrowRight']) dx = 1;
        
        gameState.player.boosting = gameState.keys['ShiftLeft'] || gameState.keys['ShiftRight'];
    } else {
        // Mobile controls
        dx = gameState.mobile.joystick.x;
        dy = gameState.mobile.joystick.y;
        gameState.player.boosting = gameState.mobile.boosting;
    }
    
    // Normalize diagonal movement
    if (dx !== 0 && dy !== 0) {
        const length = Math.sqrt(dx * dx + dy * dy);
        dx /= length;
        dy /= length;
    }
    
    // Apply boost
    let speed = CONFIG.BASE_SPEED;
    if (gameState.player.boosting && gameState.player.territory.size >= CONFIG.BOOST_COST) {
        speed *= CONFIG.BOOST_MULTIPLIER;
        
        // Consume territory for boost (every second)
        const now = Date.now();
        if (now - (gameState.player.lastBoostCost || 0) > 1000) {
            gameState.player.territory.delete(Array.from(gameState.player.territory)[0]);
            gameState.player.lastBoostCost = now;
        }
    }
    
    // Update position
    gameState.player.x += dx * speed;
    gameState.player.y += dy * speed;
    
    // Keep player in bounds
    gameState.player.x = Math.max(CONFIG.TILE_SIZE/2, Math.min(CONFIG.MAP_SIZE.width * CONFIG.TILE_SIZE - CONFIG.TILE_SIZE/2, gameState.player.x));
    gameState.player.y = Math.max(CONFIG.TILE_SIZE/2, Math.min(CONFIG.MAP_SIZE.height * CONFIG.TILE_SIZE - CONFIG.TILE_SIZE/2, gameState.player.y));
    
    // Update grid position
    const newGridX = Math.floor(gameState.player.x / CONFIG.TILE_SIZE);
    const newGridY = Math.floor(gameState.player.y / CONFIG.TILE_SIZE);
    const gridKey = `${newGridX},${newGridY}`;
    
    // Check if in own territory
    const inOwnTerritory = gameState.player.territory.has(gridKey);
    
    if (inOwnTerritory) {
        // Player returned to territory - claim enclosed area
        if (gameState.player.trail.length > 0) {
            claimEnclosedArea(gameState.player);
            gameState.player.trail = [];
        }
    } else {
        // Add to trail if not already there
        if (gameState.player.trail.length === 0 || 
            gameState.player.trail[gameState.player.trail.length - 1] !== gridKey) {
            gameState.player.trail.push(gridKey);
        }
    }
    
    gameState.player.gridX = newGridX;
    gameState.player.gridY = newGridY;
    
    // Update camera
    camera.x = gameState.player.x - canvas.width / 2;
    camera.y = gameState.player.y - canvas.height / 2;
}

function claimEnclosedArea(player) {
    // Simple flood fill to find enclosed area
    const enclosed = new Set();
    const toCheck = [];
    
    // Add all trail positions to territory
    player.trail.forEach(pos => {
        player.territory.add(pos);
    });
    
    // Find areas that should be claimed (simplified)
    const minX = Math.min(...player.trail.map(pos => parseInt(pos.split(',')[0])));
    const maxX = Math.max(...player.trail.map(pos => parseInt(pos.split(',')[0])));
    const minY = Math.min(...player.trail.map(pos => parseInt(pos.split(',')[1])));
    const maxY = Math.max(...player.trail.map(pos => parseInt(pos.split(',')[1])));
    
    for (let x = minX; x <= maxX; x++) {
        for (let y = minY; y <= maxY; y++) {
            const key = `${x},${y}`;
            if (!player.territory.has(key)) {
                player.territory.add(key);
            }
        }
    }
}

function updateAI() {
    gameState.players.forEach(player => {
        if (!player.alive) return;
        
        // Simple AI: random movement with some territory expansion logic
        const directions = [
            { dx: 0, dy: -1 }, { dx: 0, dy: 1 },
            { dx: -1, dy: 0 }, { dx: 1, dy: 0 }
        ];
        
        const dir = directions[Math.floor(Math.random() * directions.length)];
        
        player.x += dir.dx * CONFIG.BASE_SPEED;
        player.y += dir.dy * CONFIG.BASE_SPEED;
        
        // Keep in bounds
        player.x = Math.max(CONFIG.TILE_SIZE/2, Math.min(CONFIG.MAP_SIZE.width * CONFIG.TILE_SIZE - CONFIG.TILE_SIZE/2, player.x));
        player.y = Math.max(CONFIG.TILE_SIZE/2, Math.min(CONFIG.MAP_SIZE.height * CONFIG.TILE_SIZE - CONFIG.TILE_SIZE/2, player.y));
        
        // Update grid position and territory logic (simplified)
        const gridX = Math.floor(player.x / CONFIG.TILE_SIZE);
        const gridY = Math.floor(player.y / CONFIG.TILE_SIZE);
        const gridKey = `${gridX},${gridY}`;
        
        if (Math.random() < 0.1) { // 10% chance to claim territory
            player.territory.add(gridKey);
        }
    });
}

function shoot() {
    if (!gameState.player || !gameState.player.alive) return;
    
    const now = Date.now();
    if (now - gameState.player.lastShot < 500) return; // Rate limit
    
    if (gameState.player.territory.size < CONFIG.SHOT_COST) return; // Not enough territory
    
    // Remove territory cost
    for (let i = 0; i < CONFIG.SHOT_COST && gameState.player.territory.size > 0; i++) {
        const territories = Array.from(gameState.player.territory);
        gameState.player.territory.delete(territories[0]);
    }
    
    // Get shooting direction based on last movement
    let dx = 0, dy = -1; // Default: up
    
    if (window.innerWidth > 768) {
        if (gameState.keys['KeyW'] || gameState.keys['ArrowUp']) { dx = 0; dy = -1; }
        else if (gameState.keys['KeyS'] || gameState.keys['ArrowDown']) { dx = 0; dy = 1; }
        else if (gameState.keys['KeyA'] || gameState.keys['ArrowLeft']) { dx = -1; dy = 0; }
        else if (gameState.keys['KeyD'] || gameState.keys['ArrowRight']) { dx = 1; dy = 0; }
    } else {
        if (Math.abs(gameState.mobile.joystick.x) > Math.abs(gameState.mobile.joystick.y)) {
            dx = gameState.mobile.joystick.x > 0 ? 1 : -1;
            dy = 0;
        } else {
            dx = 0;
            dy = gameState.mobile.joystick.y > 0 ? 1 : -1;
        }
    }
    
    // Create projectile
    const projectile = {
        x: gameState.player.x,
        y: gameState.player.y,
        dx: dx * CONFIG.PROJECTILE_SPEED,
        dy: dy * CONFIG.PROJECTILE_SPEED,
        owner: gameState.player.id,
        life: 3000 // 3 second lifespan
    };
    
    gameState.projectiles.push(projectile);
    gameState.player.lastShot = now;
}

function updateProjectiles() {
    const now = Date.now();
    
    gameState.projectiles = gameState.projectiles.filter(projectile => {
        projectile.x += projectile.dx;
        projectile.y += projectile.dy;
        projectile.life -= 16; // Assuming 60 FPS
        
        // Remove if out of bounds or expired
        if (projectile.x < 0 || projectile.x > CONFIG.MAP_SIZE.width * CONFIG.TILE_SIZE ||
            projectile.y < 0 || projectile.y > CONFIG.MAP_SIZE.height * CONFIG.TILE_SIZE ||
            projectile.life <= 0) {
            return false;
        }
        
        // Check collision with players
        const targets = [gameState.player, ...Array.from(gameState.players.values())];
        for (const target of targets) {
            if (target && target.alive && target.id !== projectile.owner) {
                const distance = Math.sqrt(
                    Math.pow(projectile.x - target.x, 2) + 
                    Math.pow(projectile.y - target.y, 2)
                );
                
                if (distance < CONFIG.PLAYER_SIZE) {
                    // Hit! Kill the target
                    target.alive = false;
                    
                    // Award kill to shooter
                    if (projectile.owner === gameState.player.id) {
                        gameState.player.kills++;
                    }
                    
                    return false; // Remove projectile
                }
            }
        }
        
        return true;
    });
}

function checkCollisions() {
    if (!gameState.player || !gameState.player.alive) return;
    
    // Check trail collisions
    gameState.players.forEach(otherPlayer => {
        if (otherPlayer.alive && otherPlayer.id !== gameState.player.id) {
            // Check if we hit their trail
            const ourGridKey = `${gameState.player.gridX},${gameState.player.gridY}`;
            if (otherPlayer.trail.includes(ourGridKey)) {
                // We hit their trail - they die
                otherPlayer.alive = false;
                gameState.player.kills++;
                
                // Claim their territory
                otherPlayer.territory.forEach(tile => {
                    gameState.player.territory.add(tile);
                });
            }
            
            // Check if they hit our trail
            const theirGridKey = `${otherPlayer.gridX},${otherPlayer.gridY}`;
            if (gameState.player.trail.includes(theirGridKey)) {
                // They hit our trail - we die
                gameState.player.alive = false;
                showDeathScreen();
            }
        }
    });
}

function updateHUD() {
    if (!gameState.player) return;
    
    // Calculate territory percentage
    const totalTiles = CONFIG.MAP_SIZE.width * CONFIG.MAP_SIZE.height;
    const territoryPercent = ((gameState.player.territory.size / totalTiles) * 100).toFixed(1);
    
    document.getElementById('territoryPercent').textContent = territoryPercent;
    document.getElementById('killCount').textContent = gameState.player.kills;
    document.getElementById('ammoCount').textContent = Math.floor(gameState.player.territory.size / CONFIG.SHOT_COST);
    
    // Update boost meter
    const boostFill = document.getElementById('boostFill');
    const boostPercent = Math.min(100, (gameState.player.territory.size / 50) * 100);
    boostFill.style.width = boostPercent + '%';
    
    // Update leaderboard
    updateLeaderboard();
}

function updateLeaderboard() {
    const leaderboardList = document.getElementById('leaderboardList');
    const allPlayers = [gameState.player, ...Array.from(gameState.players.values())]
        .filter(p => p && p.alive)
        .sort((a, b) => b.territory.size - a.territory.size)
        .slice(0, 10);
    
    leaderboardList.innerHTML = allPlayers.map((player, index) => {
        const totalTiles = CONFIG.MAP_SIZE.width * CONFIG.MAP_SIZE.height;
        const percent = ((player.territory.size / totalTiles) * 100).toFixed(1);
        return `<div class="leaderboard-item">
            <span>${index + 1}. ${player.name}</span>
            <span>${percent}%</span>
        </div>`;
    }).join('');
}

function render() {
    if (gameState.currentScreen !== 'game') return;
    
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Draw background grid
    drawGrid();
    
    // Draw territories
    drawTerritories();
    
    // Draw trails
    drawTrails();
    
    // Draw players
    drawPlayers();
    
    // Draw projectiles
    drawProjectiles();
}

function drawGrid() {
    ctx.strokeStyle = '#7f8c8d';
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.3;
    
    const startX = Math.floor(camera.x / CONFIG.TILE_SIZE) * CONFIG.TILE_SIZE;
    const startY = Math.floor(camera.y / CONFIG.TILE_SIZE) * CONFIG.TILE_SIZE;
    
    for (let x = startX; x < camera.x + canvas.width + CONFIG.TILE_SIZE; x += CONFIG.TILE_SIZE) {
        ctx.beginPath();
        ctx.moveTo(x - camera.x, 0);
        ctx.lineTo(x - camera.x, canvas.height);
        ctx.stroke();
    }
    
    for (let y = startY; y < camera.y + canvas.height + CONFIG.TILE_SIZE; y += CONFIG.TILE_SIZE) {
        ctx.beginPath();
        ctx.moveTo(0, y - camera.y);
        ctx.lineTo(canvas.width, y - camera.y);
        ctx.stroke();
    }
    
    ctx.globalAlpha = 1;
}

function drawTerritories() {
    // Draw player territory
    if (gameState.player) {
        ctx.fillStyle = gameState.player.color;
        ctx.globalAlpha = 0.6;
        
        gameState.player.territory.forEach(tile => {
            const [x, y] = tile.split(',').map(Number);
            const screenX = x * CONFIG.TILE_SIZE - camera.x;
            const screenY = y * CONFIG.TILE_SIZE - camera.y;
            
            if (screenX > -CONFIG.TILE_SIZE && screenX < canvas.width &&
                screenY > -CONFIG.TILE_SIZE && screenY < canvas.height) {
                ctx.fillRect(screenX, screenY, CONFIG.TILE_SIZE, CONFIG.TILE_SIZE);
            }
        });
    }
    
    // Draw other players' territories
    gameState.players.forEach(player => {
        if (player.alive) {
            ctx.fillStyle = player.color;
            ctx.globalAlpha = 0.4;
            
            player.territory.forEach(tile => {
                const [x, y] = tile.split(',').map(Number);
                const screenX = x * CONFIG.TILE_SIZE - camera.x;
                const screenY = y * CONFIG.TILE_SIZE - camera.y;
                
                if (screenX > -CONFIG.TILE_SIZE && screenX < canvas.width &&
                    screenY > -CONFIG.TILE_SIZE && screenY < canvas.height) {
                    ctx.fillRect(screenX, screenY, CONFIG.TILE_SIZE, CONFIG.TILE_SIZE);
                }
            });
        }
    });
    
    ctx.globalAlpha = 1;
}

function drawTrails() {
    // Draw player trail
    if (gameState.player && gameState.player.trail.length > 0) {
        ctx.fillStyle = gameState.player.color;
        ctx.globalAlpha = 0.7;
        
        gameState.player.trail.forEach(tile => {
            const [x, y] = tile.split(',').map(Number);
            const screenX = x * CONFIG.TILE_SIZE - camera.x;
            const screenY = y * CONFIG.TILE_SIZE - camera.y;
            
            if (screenX > -CONFIG.TILE_SIZE && screenX < canvas.width &&
                screenY > -CONFIG.TILE_SIZE && screenY < canvas.height) {
                ctx.fillRect(screenX + 2, screenY + 2, CONFIG.TILE_SIZE - 4, CONFIG.TILE_SIZE - 4);
            }
        });
    }
    
    // Draw other players' trails
    gameState.players.forEach(player => {
        if (player.alive && player.trail.length > 0) {
            ctx.fillStyle = player.color;
            ctx.globalAlpha = 0.5;
            
            player.trail.forEach(tile => {
                const [x, y] = tile.split(',').map(Number);
                const screenX = x * CONFIG.TILE_SIZE - camera.x;
                const screenY = y * CONFIG.TILE_SIZE - camera.y;
                
                if (screenX > -CONFIG.TILE_SIZE && screenX < canvas.width &&
                    screenY > -CONFIG.TILE_SIZE && screenY < canvas.height) {
                    ctx.fillRect(screenX + 2, screenY + 2, CONFIG.TILE_SIZE - 4, CONFIG.TILE_SIZE - 4);
                }
            });
        }
    });
    
    ctx.globalAlpha = 1;
}

function drawPlayers() {
    // Draw other players
    gameState.players.forEach(player => {
        if (player.alive) {
            const screenX = player.x - camera.x;
            const screenY = player.y - camera.y;
            
            if (screenX > -50 && screenX < canvas.width + 50 &&
                screenY > -50 && screenY < canvas.height + 50) {
                
                // Draw player square
                ctx.fillStyle = player.color;
                ctx.fillRect(
                    screenX - CONFIG.PLAYER_SIZE/2,
                    screenY - CONFIG.PLAYER_SIZE/2,
                    CONFIG.PLAYER_SIZE,
                    CONFIG.PLAYER_SIZE
                );
                
                // Draw player name
                ctx.fillStyle = 'white';
                ctx.font = '12px Arial';
                ctx.textAlign = 'center';
                ctx.fillText(player.name, screenX, screenY - 25);
            }
        }
    });
    
    // Draw main player
    if (gameState.player && gameState.player.alive) {
        const screenX = gameState.player.x - camera.x;
        const screenY = gameState.player.y - camera.y;
        
        // Draw player square
        ctx.fillStyle = gameState.player.color;
        ctx.fillRect(
            screenX - CONFIG.PLAYER_SIZE/2,
            screenY - CONFIG.PLAYER_SIZE/2,
            CONFIG.PLAYER_SIZE,
            CONFIG.PLAYER_SIZE
        );
        
        // Draw boost effect
        if (gameState.player.boosting) {
            ctx.strokeStyle = 'yellow';
            ctx.lineWidth = 3;
            ctx.strokeRect(
                screenX - CONFIG.PLAYER_SIZE/2 - 2,
                screenY - CONFIG.PLAYER_SIZE/2 - 2,
                CONFIG.PLAYER_SIZE + 4,
                CONFIG.PLAYER_SIZE + 4
            );
        }
        
        // Draw player name
        ctx.fillStyle = 'white';
        ctx.font = 'bold 14px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(gameState.player.name, screenX, screenY - 25);
    }
}

function drawProjectiles() {
    ctx.fillStyle = 'white';
    ctx.shadowColor = 'white';
    ctx.shadowBlur = 10;
    
    gameState.projectiles.forEach(projectile => {
        const screenX = projectile.x - camera.x;
        const screenY = projectile.y - camera.y;
        
        if (screenX > -20 && screenX < canvas.width + 20 &&
            screenY > -20 && screenY < canvas.height + 20) {
            
            ctx.beginPath();
            ctx.arc(screenX, screenY, 4, 0, Math.PI * 2);
            ctx.fill();
        }
    });
    
    ctx.shadowBlur = 0;
}

function showDeathScreen() {
    const survivalTime = Math.floor((Date.now() - gameState.gameStartTime) / 1000);
    const totalTiles = CONFIG.MAP_SIZE.width * CONFIG.MAP_SIZE.height;
    const territoryPercent = ((gameState.player.territory.size / totalTiles) * 100).toFixed(1);
    const coinsEarned = Math.floor(parseFloat(territoryPercent) * CONFIG.COINS_PER_PERCENT);
    
    document.getElementById('finalTerritory').textContent = territoryPercent;
    document.getElementById('finalKills').textContent = gameState.player.kills;
    document.getElementById('survivalTime').textContent = survivalTime;
    document.getElementById('coinsEarned').textContent = coinsEarned;
    
    // Award coins
    userData.coins += coinsEarned;
    userData.stats.gamesPlayed++;
    userData.stats.totalKills += gameState.player.kills;
    if (parseFloat(territoryPercent) > userData.stats.bestTerritory) {
        userData.stats.bestTerritory = parseFloat(territoryPercent);
    }
    
    updatePlayerInfo();
    saveUserData();
    
    document.getElementById('deathScreen').classList.remove('hidden');
}

function respawn() {
    document.getElementById('deathScreen').classList.add('hidden');
    startGame();
}

function playAgain() {
    document.getElementById('victoryScreen').classList.add('hidden');
    startGame();
}

function backToLobby() {
    document.getElementById('deathScreen').classList.add('hidden');
    document.getElementById('victoryScreen').classList.add('hidden');
    showScreen('lobby');
}

// Data persistence (in-memory simulation)
function loadUserData() {
    // In a real app, this would load from server
    // For demo, we'll keep the default userData
}

function saveUserData() {
    // In a real app, this would save to server
    // For demo, data persists in memory during session
}

// Game loop
function gameLoop(timestamp) {
    const deltaTime = timestamp - gameState.lastUpdateTime;
    gameState.lastUpdateTime = timestamp;
    
    if (gameState.currentScreen === 'game' && gameState.player && gameState.player.alive) {
        updatePlayer();
        updateAI();
        updateProjectiles();
        checkCollisions();
        updateHUD();
    }
    
    render();
    requestAnimationFrame(gameLoop);
}

// Initialize when page loads
window.addEventListener('load', initGame);

// Check for game end conditions
setInterval(() => {
    if (gameState.currentScreen === 'game' && gameState.player) {
        const elapsed = (Date.now() - gameState.gameStartTime) / 1000;
        
        // Check time limit
        if (elapsed >= CONFIG.GAME_DURATION) {
            // Game over - time limit
            showVictoryScreen();
        }
        
        // Check domination
        const totalTiles = CONFIG.MAP_SIZE.width * CONFIG.MAP_SIZE.height;
        const territoryPercent = (gameState.player.territory.size / totalTiles) * 100;
        
        if (territoryPercent >= 80) {
            // Victory by domination
            showVictoryScreen();
        }
    }
}, 1000);

function showVictoryScreen() {
    const gameDuration = Math.floor((Date.now() - gameState.gameStartTime) / 1000);
    const totalTiles = CONFIG.MAP_SIZE.width * CONFIG.MAP_SIZE.height;
    const territoryPercent = ((gameState.player.territory.size / totalTiles) * 100).toFixed(1);
    const coinsEarned = Math.floor(parseFloat(territoryPercent) * CONFIG.COINS_PER_PERCENT * 2); // Bonus for winning
    
    document.getElementById('victoryTerritory').textContent = territoryPercent;
    document.getElementById('victoryKills').textContent = gameState.player.kills;
    document.getElementById('gameDuration').textContent = gameDuration;
    document.getElementById('victoryCoins').textContent = coinsEarned;
    
    // Award coins and update stats
    userData.coins += coinsEarned;
    userData.stats.gamesPlayed++;
    userData.stats.totalKills += gameState.player.kills;
    if (parseFloat(territoryPercent) > userData.stats.bestTerritory) {
        userData.stats.bestTerritory = parseFloat(territoryPercent);
    }
    
    updatePlayerInfo();
    saveUserData();
    
    document.getElementById('victoryScreen').classList.remove('hidden');
}