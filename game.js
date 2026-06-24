// ===========================
// 坦克大战 - Tank Battle Game
// ===========================

// --- DOM Elements ---
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const scoreDisplay = document.getElementById('scoreDisplay');
const levelDisplay = document.getElementById('levelDisplay');
const livesDisplay = document.getElementById('livesDisplay');
const levelUpEl = document.getElementById('levelUp');
const gameOverScreen = document.getElementById('gameOverScreen');
const gameOverTitle = document.getElementById('gameOverTitle');
const finalScore = document.getElementById('finalScore');
const restartBtn = document.getElementById('restartBtn');

// --- Constants ---
const COLS = 26;
const ROWS = 26;
const CELL = 28;
const WIDTH = COLS * CELL;
const HEIGHT = ROWS * CELL;

canvas.width = WIDTH;
canvas.height = HEIGHT;

// Map tiles
const EMPTY = 0;
const BRICK = 1;
const STEEL = 2;
const WATER = 3;
const BASE = 4;

// Directions
const UP = 0;
const RIGHT = 1;
const DOWN = 2;
const LEFT = 3;

// Speeds (pixels per second)
const PLAYER_SPEED = 100;
const ENEMY_BASE_SPEED = 40;
const ENEMY_SPEED_PER_LEVEL = 8;
const BULLET_SPEED = 360;

// Timings (seconds)
const PLAYER_SHOOT_DELAY = 0.35;
const ENEMY_SHOOT_DELAY = 1.0;
const SHIELD_DURATION = 8.0;
const RAPID_FIRE_DURATION = 5.0;
const BIG_BULLETS_DURATION = 6.0;
const FREEZE_DURATION = 3.0;
const FREEZE_SPEED = 16;
const POWERUP_LIFETIME = 10.0;

// --- Game State ---
let map = [];
let player = null;
let enemies = [];
let bullets = [];
let explosions = [];
let powerups = [];
let score = 0;
let level = 1;
let lives = 3;
let gameOver = false;
let gamePaused = false;
let enemySpawnTimer = 0;
let totalEnemiesSpawned = 0;
let enemiesRemaining = 0;
let powerupTimer = 0;
let baseAlive = true;
let lastFrameTime = 0;

// --- Input Handling ---
const keys = {};
window.addEventListener('keydown', e => {
    if (e.repeat) return;
    keys[e.key.toLowerCase()] = true;
    if (e.key.toLowerCase() === 'p' && !gameOver) {
        gamePaused = !gamePaused;
    }
    e.preventDefault();
});
window.addEventListener('keyup', e => {
    keys[e.key.toLowerCase()] = false;
    e.preventDefault();
});

// --- Map Generation ---
function generateMap() {
    map = Array.from({length: ROWS}, () => Array(COLS).fill(EMPTY));

    // Brick walls - maze-like patterns
    for (let r = 1; r < ROWS - 1; r++) {
        for (let c = 1; c < COLS - 1; c++) {
            if (r <= 2 || r >= ROWS - 3 || c <= 2 || c >= COLS - 3) continue;
            // Leave base area clear
            if (r >= ROWS - 5 && c >= Math.floor(COLS/2) - 2 && c <= Math.floor(COLS/2) + 2) continue;
            // Player spawn area
            if (r <= 4 && c >= Math.floor(COLS/2) - 3 && c <= Math.floor(COLS/2) + 3) continue;
            // Enemy spawn areas (top corners)
            if (r <= 3 && c <= 4) continue;
            if (r <= 3 && c >= COLS - 5) continue;

            if (Math.random() < 0.15 + level * 0.02) {
                map[r][c] = BRICK;
            }
        }
    }

    // Add some steel walls
    for (let r = 3; r < ROWS - 3; r++) {
        for (let c = 3; c < COLS - 3; c++) {
            if (map[r][c] === BRICK && Math.random() < 0.12) {
                map[r][c] = STEEL;
            }
        }
    }

    // Protect the base
    const baseC = Math.floor(COLS / 2);
    const baseR = ROWS - 5;
    map[baseR][baseC] = BASE;
    map[baseR + 1][baseC - 1] = BRICK;
    map[baseR + 1][baseC] = BRICK;
    map[baseR + 1][baseC + 1] = BRICK;
    map[baseR][baseC - 1] = BRICK;
    map[baseR][baseC + 1] = BRICK;

    // Clear player spawn area
    const pCol = Math.floor(COLS / 2);
    for (let r = ROWS - 3; r <= ROWS - 2; r++) {
        for (let c = pCol - 3; c <= pCol + 3; c++) {
            if (c > 0 && c < COLS - 1 && r > 0 && r < ROWS - 1) {
                map[r][c] = EMPTY;
            }
        }
    }

    // Clear enemy spawn areas
    for (const pos of [{r: 1, c: 2}, {r: 1, c: COLS - 3}]) {
        for (let dr = 0; dr <= 1; dr++) {
            for (let dc = -1; dc <= 1; dc++) {
                const nr = pos.r + dr;
                const nc = pos.c + dc;
                if (nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS) {
                    map[nr][nc] = EMPTY;
                }
            }
        }
    }
}

// --- Tank Class ---
class Tank {
    constructor(x, y, dir, color, isEnemy = false) {
        this.x = x;
        this.y = y;
        this.dir = dir;
        this.color = color;
        this.isEnemy = isEnemy;
        this.speed = isEnemy ? ENEMY_BASE_SPEED : PLAYER_SPEED;
        this.shootCooldown = 0;
        this.shootDelay = isEnemy ? ENEMY_SHOOT_DELAY : PLAYER_SHOOT_DELAY;
        this.alive = true;
        this.size = CELL * 0.85;
        this.halfSize = this.size / 2;
        this.moveTimer = 0;
        this.moveDirection = dir;
        // Powerup effects
        this.shieldActive = false;
        this.shieldTimer = 0;
        this.rapidFire = false;
        this.rapidFireTimer = 0;
        this.bigBullets = false;
        this.bigBulletsTimer = 0;
    }

    getTileAt(cx, cy) {
        const c = Math.floor(cx / CELL);
        const r = Math.floor(cy / CELL);
        return {r, c, tile: (r >= 0 && r < ROWS && c >= 0 && c < COLS) ? map[r][c] : STEEL};
    }

    canMoveTo(nx, ny) {
        // Check all corners
        const corners = [
            {cx: nx - this.halfSize, cy: ny - this.halfSize},
            {cx: nx + this.halfSize, cy: ny - this.halfSize},
            {cx: nx - this.halfSize, cy: ny + this.halfSize},
            {cx: nx + this.halfSize, cy: ny + this.halfSize},
        ];

        for (const corner of corners) {
            const {tile} = this.getTileAt(corner.cx, corner.cy);
            if (tile === BRICK || tile === STEEL || tile === WATER) return false;
        }

        // Check bounds
        if (nx - this.halfSize < 0 || nx + this.halfSize > WIDTH ||
            ny - this.halfSize < 0 || ny + this.halfSize > HEIGHT) {
            return false;
        }

        // Check base collision
        for (const corner of corners) {
            const {tile} = this.getTileAt(corner.cx, corner.cy);
            if (tile === BASE) return false;
        }

        // Check border walls
        const {c: mc, r: mr} = this.getTileAt(nx, ny);
        if (mr <= 0 || mr >= ROWS - 1 || mc <= 0 || mc >= COLS - 1) {
            return false;
        }

        return true;
    }

    move(direction, dt) {
        this.dir = direction;
        const dist = this.speed * dt;
        let nx = this.x;
        let ny = this.y;

        switch (direction) {
            case UP: ny -= dist; break;
            case DOWN: ny += dist; break;
            case LEFT: nx -= dist; break;
            case RIGHT: nx += dist; break;
        }

        // Try full movement first
        if (this.canMoveTo(nx, ny)) {
            this.x = nx;
            this.y = ny;
            return true;
        }

        // Slide along walls
        if (direction === UP || direction === DOWN) {
            if (this.canMoveTo(this.x, ny)) { this.y = ny; return true; }
        } else {
            if (this.canMoveTo(nx, this.y)) { this.x = nx; return true; }
        }

        return false;
    }

    shoot() {
        const offset = this.halfSize + 3;
        let bx = this.x;
        let by = this.y;

        switch (this.dir) {
            case UP: by -= offset; break;
            case DOWN: by += offset; break;
            case LEFT: bx -= offset; break;
            case RIGHT: bx += offset; break;
        }

        bullets.push({
            x: bx, y: by,
            dir: this.dir,
            speed: BULLET_SPEED,
            fromPlayer: !this.isEnemy,
            big: !this.isEnemy && this.bigBullets,
            power: (!this.isEnemy && this.bigBullets) ? 2 : 0,
        });

        this.shootCooldown = this.rapidFire
            ? this.shootDelay / 3
            : this.shootDelay;
    }

    update(dt) {
        if (!this.alive) return;

        // Update powerup timers
        if (this.shieldActive) {
            this.shieldTimer -= dt;
            if (this.shieldTimer <= 0) this.shieldActive = false;
        }
        if (this.rapidFire) {
            this.rapidFireTimer -= dt;
            if (this.rapidFireTimer <= 0) this.rapidFire = false;
        }
        if (this.bigBullets) {
            this.bigBulletsTimer -= dt;
            if (this.bigBulletsTimer <= 0) this.bigBullets = false;
        }

        if (this.shootCooldown > 0) this.shootCooldown -= dt;

        if (this.isEnemy) {
            this.moveTimer -= dt;

            // AI: change direction periodically
            if (this.moveTimer <= 0) {
                this.moveDirection = Math.floor(Math.random() * 4);
                this.moveTimer = 0.5 + Math.random() * 1.5;
            }

            // Try to shoot at player if aligned
            const dx = player.x - this.x;
            const dy = player.y - this.y;
            let shootDir = -1;
            if (Math.abs(dx) < CELL && Math.abs(dy) > CELL) {
                shootDir = dy < 0 ? UP : DOWN;
            } else if (Math.abs(dy) < CELL && Math.abs(dx) > CELL) {
                shootDir = dx < 0 ? LEFT : RIGHT;
            }

            if (shootDir !== -1 && Math.random() < 0.02 && this.shootCooldown <= 0) {
                this.dir = shootDir;
                this.shoot();
            }

            // Move or try another direction if blocked
            if (!this.move(this.moveDirection, dt)) {
                this.moveDirection = Math.floor(Math.random() * 4);
                this.move(this.moveDirection, dt);
            }

            // Random shooting
            if (Math.random() < 0.008 && this.shootCooldown <= 0) {
                this.dir = this.moveDirection;
                this.shoot();
            }
        } else {
            // Player input
            if (!gamePaused) {
                if (keys['w'] || keys['arrowup']) this.move(UP, dt);
                else if (keys['s'] || keys['arrowdown']) this.move(DOWN, dt);
                else if (keys['a'] || keys['arrowleft']) this.move(LEFT, dt);
                else if (keys['d'] || keys['arrowright']) this.move(RIGHT, dt);

                if ((keys[' '] || keys['space']) && this.shootCooldown <= 0) {
                    this.shoot();
                }
            }
        }
    }

    draw() {
        if (!this.alive) return;

        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.rotate(this.dir * Math.PI / 2);

        const s = this.size / 2;

        // Treads
        ctx.fillStyle = '#222';
        ctx.fillRect(-s - 2, -s * 0.9, 4, s * 1.8);
        ctx.fillRect(s - 2, -s * 0.9, 4, s * 1.8);

        // Tread details
        ctx.fillStyle = '#444';
        for (let i = -3; i <= 3; i++) {
            const ty = i * s * 0.22;
            ctx.fillRect(-s - 1, ty - 1, 3, 2);
            ctx.fillRect(s, ty - 1, 3, 2);
        }

        // Tank body
        ctx.fillStyle = this.color;
        ctx.fillRect(-s, -s * 0.8, s * 2, s * 1.6);

        // Turret
        ctx.fillStyle = this.isEnemy ? '#b33' : '#4a4';
        ctx.beginPath();
        ctx.arc(0, 0, s * 0.5, 0, Math.PI * 2);
        ctx.fill();

        // Cannon
        ctx.fillStyle = '#ccc';
        ctx.fillRect(-2, -s * 0.7, 4, s * 0.7);

        // Shield effect
        if (this.shieldActive) {
            ctx.strokeStyle = 'rgba(0, 255, 255, 0.7)';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(0, 0, s + 2, 0, Math.PI * 2);
            ctx.stroke();
        }

        ctx.restore();
    }

    hitBy(bullet) {
        const dx = bullet.x - this.x;
        const dy = bullet.y - this.y;
        return Math.sqrt(dx * dx + dy * dy) < this.halfSize;
    }
}

// --- Rendering ---

function drawMap() {
    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            const x = c * CELL;
            const y = r * CELL;
            const tile = map[r][c];

            switch (tile) {
                case BRICK:
                    ctx.fillStyle = '#b5651d';
                    ctx.fillRect(x, y, CELL, CELL);
                    ctx.fillStyle = '#d2691e';
                    ctx.fillRect(x + 1, y + 1, Math.floor(CELL/2)-1, Math.floor(CELL/2)-1);
                    ctx.fillRect(x + Math.floor(CELL/2), y + Math.floor(CELL/2), Math.floor(CELL/2)-1, Math.floor(CELL/2)-1);
                    ctx.strokeStyle = '#8b4513';
                    ctx.lineWidth = 0.5;
                    ctx.strokeRect(x + 0.5, y + 0.5, CELL - 1, CELL - 1);
                    break;
                case STEEL:
                    ctx.fillStyle = '#888';
                    ctx.fillRect(x, y, CELL, CELL);
                    ctx.fillStyle = '#aaa';
                    ctx.fillRect(x + 2, y + 2, CELL - 4, CELL - 4);
                    ctx.fillStyle = '#666';
                    ctx.fillRect(x + 4, y + 4, CELL - 8, CELL - 8);
                    ctx.strokeStyle = '#555';
                    ctx.lineWidth = 1;
                    ctx.strokeRect(x + 1, y + 1, CELL - 2, CELL - 2);
                    break;
                case WATER:
                    ctx.fillStyle = '#1a3a5c';
                    ctx.fillRect(x, y, CELL, CELL);
                    ctx.fillStyle = '#2a5a8c';
                    for (let i = 0; i < 3; i++) {
                        ctx.fillRect(x + 4 + i * 7, y + 6, 2, CELL - 12);
                    }
                    break;
                case BASE:
                    ctx.fillStyle = '#333';
                    ctx.fillRect(x, y, CELL, CELL);
                    ctx.fillStyle = '#ffd700';
                    ctx.beginPath();
                    ctx.moveTo(x + CELL/2, y + 2);
                    ctx.lineTo(x + CELL - 4, y + CELL - 6);
                    ctx.lineTo(x + CELL/2 + 6, y + CELL/2);
                    ctx.lineTo(x + CELL/2 - 6, y + CELL/2);
                    ctx.lineTo(x + 4, y + CELL - 6);
                    ctx.closePath();
                    ctx.fill();
                    ctx.fillStyle = '#b8860b';
                    ctx.fillRect(x + CELL/2 - 3, y + CELL/2, 6, CELL/2 - 2);
                    break;
            }
        }
    }

    // Grid lines
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
    ctx.lineWidth = 0.5;
    for (let r = 0; r <= ROWS; r++) {
        ctx.beginPath();
        ctx.moveTo(0, r * CELL);
        ctx.lineTo(WIDTH, r * CELL);
        ctx.stroke();
    }
    for (let c = 0; c <= COLS; c++) {
        ctx.beginPath();
        ctx.moveTo(c * CELL, 0);
        ctx.lineTo(c * CELL, HEIGHT);
        ctx.stroke();
    }

    // Border walls
    ctx.fillStyle = '#555';
    ctx.fillRect(0, 0, WIDTH, CELL);
    ctx.fillRect(0, HEIGHT - CELL, WIDTH, CELL);
    ctx.fillRect(0, 0, CELL, HEIGHT);
    ctx.fillRect(WIDTH - CELL, 0, CELL, HEIGHT);
}

function drawPowerup(p) {
    const s = CELL * 0.35;
    const pulse = Math.sin(Date.now() / 200) * 0.15;

    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.scale(1 + pulse, 1 + pulse);

    ctx.fillStyle = p.type === 'shield' ? '#0ff' :
                    p.type === 'rapid' ? '#f80' :
                    p.type === 'big' ? '#f44' :
                    p.type === 'extraLife' ? '#f0f' : '#88f';
    ctx.beginPath();
    ctx.arc(0, 0, s, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#fff';
    ctx.font = `${s}px Arial`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const icon = p.type === 'shield' ? '🛡' :
                 p.type === 'rapid' ? '⚡' :
                 p.type === 'big' ? '💥' :
                 p.type === 'extraLife' ? '❤' : '❄';
    ctx.fillText(icon, 0, 1);

    ctx.restore();
}

function drawExplosion(ex) {
    const progress = ex.timer / ex.maxTimer;
    const radius = ex.maxRadius * (1 - progress);
    const alpha = progress;

    const gradient = ctx.createRadialGradient(ex.x, ex.y, 0, ex.x, ex.y, radius);
    gradient.addColorStop(0, `rgba(255, 255, 200, ${alpha})`);
    gradient.addColorStop(0.3, `rgba(255, 200, 0, ${alpha * 0.8})`);
    gradient.addColorStop(0.7, `rgba(255, 100, 0, ${alpha * 0.5})`);
    gradient.addColorStop(1, `rgba(255, 0, 0, 0)`);

    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(ex.x, ex.y, radius, 0, Math.PI * 2);
    ctx.fill();

    // Spark particles
    for (let i = 0; i < 6; i++) {
        const angle = (i / 6) * Math.PI * 2 + progress * 2;
        const dist = radius * 0.6;
        const sx = ex.x + Math.cos(angle) * dist;
        const sy = ex.y + Math.sin(angle) * dist;
        ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
        ctx.fillRect(sx - 1, sy - 1, 2, 2);
    }
}

// --- Powerup System ---

function spawnPowerup() {
    const types = ['shield', 'rapid', 'big', 'extraLife', 'freeze'];
    const weights = [20, 25, 20, 10, 10];
    const total = weights.reduce((a, b) => a + b, 0);
    let rand = Math.random() * total;
    let type = types[0];
    for (let i = 0; i < types.length; i++) {
        rand -= weights[i];
        if (rand <= 0) { type = types[i]; break; }
    }

    // Find an empty spot
    for (let attempts = 0; attempts < 50; attempts++) {
        const c = 3 + Math.floor(Math.random() * (COLS - 6));
        const r = 3 + Math.floor(Math.random() * (ROWS - 8));
        if (map[r][c] === EMPTY) {
            powerups.push({
                x: c * CELL + CELL / 2,
                y: r * CELL + CELL / 2,
                type,
                timer: POWERUP_LIFETIME,
            });
            return;
        }
    }
}

function checkPowerupCollisions() {
    for (let i = powerups.length - 1; i >= 0; i--) {
        const p = powerups[i];
        const dx = player.x - p.x;
        const dy = player.y - p.y;
        if (Math.sqrt(dx*dx + dy*dy) < CELL) {
            switch (p.type) {
                case 'shield':
                    player.shieldActive = true;
                    player.shieldTimer = SHIELD_DURATION;
                    break;
                case 'rapid':
                    player.rapidFire = true;
                    player.rapidFireTimer = RAPID_FIRE_DURATION;
                    break;
                case 'big':
                    player.bigBullets = true;
                    player.bigBulletsTimer = BIG_BULLETS_DURATION;
                    break;
                case 'extraLife':
                    lives = Math.min(5, lives + 1);
                    break;
                case 'freeze':
                    for (const enemy of enemies) {
                        enemy.moveTimer = 2;
                        enemy.speed = FREEZE_SPEED;
                        setTimeout(() => {
                            if (enemy.alive) enemy.speed = ENEMY_BASE_SPEED + level * ENEMY_SPEED_PER_LEVEL;
                        }, FREEZE_DURATION * 1000);
                    }
                    break;
            }
            explosions.push({
                x: p.x, y: p.y,
                timer: 0.25, maxTimer: 0.25, maxRadius: CELL * 0.8,
            });
            powerups.splice(i, 1);
            score += 50;
        }
    }
}

// --- HUD ---

function updateHUD() {
    scoreDisplay.textContent = score;
    levelDisplay.textContent = level;
    const hearts = [];
    for (let i = 0; i < lives; i++) hearts.push('❤️');
    livesDisplay.textContent = hearts.join('') || '💔';
}

// --- Init ---

function initGame() {
    score = 0;
    level = 1;
    lives = 3;
    gameOver = false;
    gamePaused = false;
    enemySpawnTimer = 0;
    totalEnemiesSpawned = 0;
    enemiesRemaining = 4 + level * 2;
    powerupTimer = 0;
    baseAlive = true;
    bullets = [];
    enemies = [];
    explosions = [];
    powerups = [];

    generateMap();

    player = new Tank(
        Math.floor(COLS / 2) * CELL + CELL / 2,
        (ROWS - 1.5) * CELL,
        UP,
        '#2ecc40',
        false
    );

    updateHUD();
}

function nextLevel() {
    level++;
    enemiesRemaining = 4 + level * 2;
    totalEnemiesSpawned = 0;
    enemySpawnTimer = 0;
    bullets = [];
    enemies = [];
    explosions = [];
    powerups = [];
    baseAlive = true;

    generateMap();

    player.x = Math.floor(COLS / 2) * CELL + CELL / 2;
    player.y = (ROWS - 1.5) * CELL;
    player.dir = UP;
    player.shieldActive = false;
    player.rapidFire = false;
    player.bigBullets = false;

    levelUpEl.classList.add('active');
    setTimeout(() => levelUpEl.classList.remove('active'), 1500);

    updateHUD();
}

function spawnEnemy() {
    if (totalEnemiesSpawned >= enemiesRemaining) return false;

    const spawnPoints = [
        {x: 2 * CELL + CELL/2, y: 1 * CELL + CELL/2},
        {x: (COLS - 3) * CELL + CELL/2, y: 1 * CELL + CELL/2},
        {x: 2 * CELL + CELL/2, y: 3 * CELL + CELL/2},
        {x: (COLS - 3) * CELL + CELL/2, y: 3 * CELL + CELL/2},
    ];

    for (const sp of spawnPoints) {
        let occupied = false;
        for (const enemy of enemies) {
            const dx = enemy.x - sp.x;
            const dy = enemy.y - sp.y;
            if (Math.sqrt(dx*dx + dy*dy) < CELL) { occupied = true; break; }
        }
        const dx = player.x - sp.x;
        const dy = player.y - sp.y;
        if (Math.sqrt(dx*dx + dy*dy) < CELL) occupied = true;

        if (!occupied) {
            const colors = ['#e74c3c', '#e67e22', '#9b59b6', '#1abc9c'];
            const enemy = new Tank(sp.x, sp.y, DOWN, colors[Math.floor(Math.random() * colors.length)], true);
            enemy.speed = ENEMY_BASE_SPEED + level * ENEMY_SPEED_PER_LEVEL;
            enemies.push(enemy);
            totalEnemiesSpawned++;
            return true;
        }
    }
    return false;
}

// --- Game Loop ---

function update(dt) {
    if (gameOver || gamePaused) return;

    // Update player
    player.update(dt);

    // Tank-tank collision resolution
    const allTanks = [player, ...enemies];
    for (let i = 0; i < allTanks.length; i++) {
        for (let j = i + 1; j < allTanks.length; j++) {
            if (!allTanks[i].alive || !allTanks[j].alive) continue;
            const dx = allTanks[i].x - allTanks[j].x;
            const dy = allTanks[i].y - allTanks[j].y;
            const dist = Math.sqrt(dx*dx + dy*dy);
            const minDist = allTanks[i].halfSize + allTanks[j].halfSize;
            if (dist < minDist) {
                const nx = dx / dist;
                const ny = dy / dist;
                const push = (minDist - dist) / 2;
                allTanks[i].x += nx * push;
                allTanks[j].x -= nx * push;
                allTanks[i].y += ny * push;
                allTanks[j].y -= ny * push;
            }
        }
    }

    // Update enemies
    for (const enemy of enemies) {
        enemy.update(dt);
    }

    // Enemy spawning
    enemySpawnTimer -= dt;
    if (enemySpawnTimer <= 0 && totalEnemiesSpawned < enemiesRemaining && enemies.length < 6) {
        spawnEnemy();
        enemySpawnTimer = 2 + Math.random() * 2;
    }

    // Powerup spawning
    powerupTimer -= dt;
    if (powerupTimer <= 0 && powerups.length < 2) {
        spawnPowerup();
        powerupTimer = 10 + Math.random() * 15;
    }

    // Update bullets
    for (let i = bullets.length - 1; i >= 0; i--) {
        const b = bullets[i];
        const move = b.speed * dt;

        switch (b.dir) {
            case UP: b.y -= move; break;
            case DOWN: b.y += move; break;
            case LEFT: b.x -= move; break;
            case RIGHT: b.x += move; break;
        }

        // Check bounds
        if (b.x < 0 || b.x > WIDTH || b.y < 0 || b.y > HEIGHT) {
            bullets.splice(i, 1);
            continue;
        }

        // Check wall collisions
        const col = Math.floor(b.x / CELL);
        const row = Math.floor(b.y / CELL);
        if (row >= 0 && row < ROWS && col >= 0 && col < COLS) {
            const tile = map[row][col];
            if (tile === BRICK) {
                map[row][col] = EMPTY;
                explosions.push({
                    x: col * CELL + CELL/2, y: row * CELL + CELL/2,
                    timer: 0.17, maxTimer: 0.17, maxRadius: CELL * 0.6,
                });
                bullets.splice(i, 1);
                score += 5;
                continue;
            }
            if (tile === STEEL) {
                if (b.power >= 2) {
                    map[row][col] = EMPTY;
                    explosions.push({
                        x: col * CELL + CELL/2, y: row * CELL + CELL/2,
                        timer: 0.25, maxTimer: 0.25, maxRadius: CELL * 0.8,
                    });
                    score += 10;
                } else {
                    explosions.push({
                        x: b.x, y: b.y,
                        timer: 0.13, maxTimer: 0.13, maxRadius: 6,
                    });
                }
                bullets.splice(i, 1);
                continue;
            }
            if (tile === BASE) {
                map[row][col] = EMPTY;
                baseAlive = false;
                explosions.push({
                    x: col * CELL + CELL/2, y: row * CELL + CELL/2,
                    timer: 0.67, maxTimer: 0.67, maxRadius: CELL * 2,
                });
                bullets.splice(i, 1);
                gameOver = true;
                gameOverTitle.textContent = '基地被摧毁!';
                finalScore.textContent = score;
                gameOverScreen.classList.add('active');
                continue;
            }
        }

        // Check bullet-bullet collisions
        for (let j = i - 1; j >= 0; j--) {
            const b2 = bullets[j];
            if (!b2) continue;
            if (b.fromPlayer === b2.fromPlayer) continue;
            const dx = b.x - b2.x;
            const dy = b.y - b2.y;
            if (Math.sqrt(dx*dx + dy*dy) < 8) {
                bullets.splice(Math.max(i, j), 1);
                bullets.splice(Math.min(i, j), 1);
                i--;
                break;
            }
        }
        if (i < 0) continue;

        // Check tank hits
        if (b.fromPlayer) {
            for (let j = enemies.length - 1; j >= 0; j--) {
                const enemy = enemies[j];
                if (enemy.hitBy(b)) {
                    enemy.alive = false;
                    explosions.push({
                        x: enemy.x, y: enemy.y,
                        timer: 0.42, maxTimer: 0.42, maxRadius: CELL * 0.9,
                    });
                    enemies.splice(j, 1);
                    bullets.splice(i, 1);
                    score += 100;
                    break;
                }
            }
        } else {
            if (player.alive && player.hitBy(b)) {
                bullets.splice(i, 1);

                if (player.shieldActive) {
                    player.shieldActive = false;
                    player.shieldTimer = 0;
                    explosions.push({
                        x: player.x, y: player.y,
                        timer: 0.2, maxTimer: 0.2, maxRadius: CELL * 0.6,
                    });
                    continue;
                }

                lives--;
                explosions.push({
                    x: player.x, y: player.y,
                    timer: 0.5, maxTimer: 0.5, maxRadius: CELL * 1.2,
                });

                if (lives <= 0) {
                    player.alive = false;
                    gameOver = true;
                    gameOverTitle.textContent = '游戏结束';
                    finalScore.textContent = score;
                    gameOverScreen.classList.add('active');
                } else {
                    player.x = Math.floor(COLS / 2) * CELL + CELL / 2;
                    player.y = (ROWS - 1.5) * CELL;
                    player.dir = UP;
                    player.shieldActive = true;
                    player.shieldTimer = 2.5; // 2.5s respawn shield
                }
                continue;
            }
        }
    }

    // Update explosions
    for (let i = explosions.length - 1; i >= 0; i--) {
        explosions[i].timer -= dt;
        if (explosions[i].timer <= 0) explosions.splice(i, 1);
    }

    // Update powerup timers
    for (let i = powerups.length - 1; i >= 0; i--) {
        powerups[i].timer -= dt;
        if (powerups[i].timer <= 0) powerups.splice(i, 1);
    }

    checkPowerupCollisions();

    // Check win condition
    if (totalEnemiesSpawned >= enemiesRemaining && enemies.length === 0) {
        nextLevel();
    }

    updateHUD();
}

function draw() {
    ctx.clearRect(0, 0, WIDTH, HEIGHT);
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    drawMap();

    // Powerups
    for (const p of powerups) drawPowerup(p);

    // Tanks
    if (player) player.draw();
    for (const enemy of enemies) enemy.draw();

    // Bullets
    for (const b of bullets) {
        ctx.fillStyle = b.fromPlayer ? '#ff0' : '#f66';
        const bs = b.big ? 4 : 2;
        ctx.beginPath();
        ctx.arc(b.x, b.y, bs, 0, Math.PI * 2);
        ctx.fill();

        if (b.big) {
            ctx.fillStyle = 'rgba(255, 200, 0, 0.4)';
            ctx.beginPath();
            ctx.arc(b.x, b.y, bs + 2, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    // Explosions
    for (const ex of explosions) drawExplosion(ex);

    // Pause overlay
    if (gamePaused) {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
        ctx.fillRect(0, 0, WIDTH, HEIGHT);
        ctx.fillStyle = '#fff';
        ctx.font = '36px "Courier New"';
        ctx.textAlign = 'center';
        ctx.fillText('⏸ 已暂停', WIDTH/2, HEIGHT/2);
        ctx.font = '16px "Courier New"';
        ctx.fillText('按 P 继续', WIDTH/2, HEIGHT/2 + 40);
    }
}

// --- Main Loop ---

let lastFrameTime = 0;

function gameLoop(timestamp) {
    if (lastFrameTime === 0) lastFrameTime = timestamp;
    const dt = Math.min((timestamp - lastFrameTime) / 1000, 0.1);
    lastFrameTime = timestamp;

    update(dt);
    draw();
    requestAnimationFrame(gameLoop);
}

// --- Restart ---

restartBtn.addEventListener('click', () => {
    gameOverScreen.classList.remove('active');
    initGame();
});

// --- Start ---

initGame();
requestAnimationFrame(gameLoop);

console.log('🎮 坦克大战已就绪!');
console.log('控制: W/S/A/D 或方向键移动, 空格键射击, P键暂停');
console.log('保护基地🦅，消灭所有敌人!');
console.log('🛡 护盾 | ⚡ 速射 | 💥 大炮弹 | ❤ 加命 | ❄ 冻结敌人');
