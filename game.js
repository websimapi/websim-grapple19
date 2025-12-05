import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { TrackManager } from './track.js';
import { Car } from './car.js';
import { Explosion, SpaceEnvironment } from './effects.js';
import { ActionRecorder, ReplaySystem } from './replay.js';
import { InputManager } from './input_manager.js';
import { AudioManager } from './audio_manager.js';
import { CameraManager } from './camera_manager.js';

export class Game {
    constructor() {
        this.container = document.getElementById('game-container');
        this.scoreEl = document.getElementById('score-display');
        this.grappleScoreEl = document.getElementById('grapple-display');
        this.gameOverScreen = document.getElementById('game-over-screen');
        this.finalScoreEl = document.getElementById('final-score');
        this.uiLayer = document.getElementById('ui-layer');

        this.scene = new THREE.Scene();
        this.scene.fog = new THREE.FogExp2(0x050505, 0.002);

        // removed camera setup logic
        this.cameraManager = new CameraManager();
        this.camera = this.cameraManager.camera;

        // Renderer
        this.renderer = new THREE.WebGLRenderer({ 
            antialias: false,
            preserveDrawingBuffer: true 
        }); 
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.container.appendChild(this.renderer.domElement);

        // Post Processing (Bloom)
        this.composer = new EffectComposer(this.renderer);
        this.composer.addPass(new RenderPass(this.scene, this.camera));

        const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 1.5, 0.4, 0.85);
        bloomPass.threshold = 0.1;
        bloomPass.strength = 1.2; 
        bloomPass.radius = 0.5;
        this.composer.addPass(bloomPass);

        // Lights
        this.addLights();

        // Input
        // removed input event listeners
        this.inputManager = new InputManager(this.renderer.domElement);

        // Resize
        window.addEventListener('resize', () => this.onWindowResize());

        // Game State
        this.loopStarted = false;
        this.isRunning = false;
        this.isCrashing = false;
        this.distanceTraveled = 0;
        this.explosions = [];

        // Bindings
        document.getElementById('restart-btn').addEventListener('click', () => this.reset());

        // Audio
        // removed setupAudio() and local sound variables
        this.audioManager = new AudioManager(this.camera);

        // Multiplayer / User Info
        this.room = new WebsimSocket();
        this.room.initialize();

        // Replay System
        // Updated to use deterministic JSON recording
        this.recorder = new ActionRecorder();
        this.replaySystem = null; // Initialized in start() or constructor if dependencies ready

        // Explosion / crash state
        this.explosionTriggered = false;
        this.explosionTime = 0;
        this.interceptorSpawned = false;

        // Render / replay UI refs
        this.renderOverlay = document.getElementById('render-start-screen');
        this.renderPlayBtn = document.getElementById('play-render-btn');
        this.replayLoaded = false;

        // Listen for external render commands
        window.addEventListener('message', (event) => {
            if (event.data && event.data.render) {
                this.loadReplayFromURL(event.data.render);
            }
        });

        // Detect render-mode from URL
        this.isRenderMode = !!new URLSearchParams(window.location.search).get('render');
        if (this.isRenderMode) {
            const toggleHandler = (e) => {
                // Only toggle when a replay is active
                if (this.isReplaying && this.replaySystem) {
                    if (this.replaySystem.isPlaying) {
                        // Pause and show overlay play button
                        this.replaySystem.isPlaying = false;
                        if (this.renderOverlay) {
                            this.renderOverlay.classList.remove('hidden');
                            this.renderOverlay.style.display = 'flex';
                        }
                    } else {
                        // Resume from current frame and hide overlay
                        this.replaySystem.isPlaying = true;
                        if (this.renderOverlay) {
                            this.renderOverlay.classList.add('hidden');
                        }
                    }
                }
            };
            this.renderer.domElement.addEventListener('click', toggleHandler);
            this.renderer.domElement.addEventListener('touchend', (e) => {
                e.preventDefault();
                toggleHandler(e);
            }, { passive: false });
        }
    }

    // removed setupAudio() {}

    addLights() {
        const ambientLight = new THREE.AmbientLight(0xffffff, 2.5);
        this.scene.add(ambientLight);

        const hemiLight = new THREE.HemisphereLight(0x88aaff, 0x222244, 1.2);
        this.scene.add(hemiLight);

        const dirLight = new THREE.DirectionalLight(0xffffff, 1.5);
        dirLight.position.set(20, 40, 10);
        dirLight.castShadow = false;
        this.scene.add(dirLight);
    }

    start() {
        this.audioManager.resumeContext();
        if (this.uiLayer) this.uiLayer.style.display = 'block';
        this.reset();
        if (!this.loopStarted) this.loop();
    }

    reset() {
        // Clear scene
        while(this.scene.children.length > 0){ 
            this.scene.remove(this.scene.children[0]); 
        }

        // Reset fog density
        if (this.scene.fog) this.scene.fog.density = 0.002;

        this.explosions = [];

        // Cleanup previous replay video
        const video = document.getElementById('replay-video');
        if (video) {
            video.pause();
            video.currentTime = 0;
            if (video.src && video.src.startsWith('blob:')) {
                URL.revokeObjectURL(video.src);
            }
            video.removeAttribute('src');
            video.load();
        }

        // Stop any previous recording just in case
        if (this.recorder && this.recorder.isRecording) {
            this.recorder.stop();
        }

        // Re-add lights
        this.addLights();

        if (this.spaceEnvironment) {
             this.spaceEnvironment.reset();
             this.scene.add(this.spaceEnvironment.stars);
        } else {
             this.spaceEnvironment = new SpaceEnvironment(this.scene);
        }

        this.trackManager = new TrackManager(this.scene);
        this.car = new Car(this.scene);
        this.replaySystem = new ReplaySystem(this.car, this.trackManager, this.cameraManager, this.scene, this.spaceEnvironment, this.audioManager);
        
        // Reset camera
        // removed local camera reset logic
        this.cameraManager.reset(this.car.position);

        this.isRunning = true;
        this.isReplaying = false; // New Mode
        this.isCrashing = false;
        this.explosionTriggered = false;
        this.explosionTime = 0;
        this.interceptorSpawned = false;
        this.gameOverScreen.classList.add('hidden');
        this.distanceTraveled = 0;
        this.clock = new THREE.Clock();
        // removed this.zoomTarget and this.zoomTransition

        // Start new recording
        this.recorder.start(this.trackManager);

        this.activeInterceptor = null;
        this.audioManager.playEngine();
    }

    gameOver() {
        this.isRunning = false;
        this.isCrashing = true;
        this.explosionTriggered = false;
        this.interceptorSpawned = false;
        
        // Initial fall velocity: Preserve some forward speed, add downward force
        this.fallVelocity = this.car.direction.clone().multiplyScalar(20);
        this.fallVelocity.y = -10;

        // Force detach grapple so it doesn't look weird during fall in replay
        this.car.grappleState = 'IDLE';
        this.car.updateGrappleVisuals();

        this.audioManager.stopEngine();
    }

    updateCrash(dt) {
        if (!this.explosionTriggered) {
            // Gravity
            this.fallVelocity.y -= 80 * dt; 
            
            // Apply velocity
            this.car.position.add(this.fallVelocity.clone().multiplyScalar(dt));
            this.car.mesh.position.copy(this.car.position);
            
            // Tumble rotation
            this.car.mesh.rotation.x += 5 * dt;
            this.car.mesh.rotation.z += 3 * dt;

            // Spawn Interceptor if falling deep enough
            if (!this.interceptorSpawned && this.car.position.y < -5) {
                const asteroid = this.spaceEnvironment.spawnInterceptor(this.car.position, this.fallVelocity);
                this.activeInterceptor = asteroid;
                this.recorder.recordInterceptor(asteroid.mesh.position, asteroid.velocity);
                this.interceptorSpawned = true;
            }

            // Check Collision with Asteroids
            const hit = this.spaceEnvironment.checkCollisions(this.car.position);
            
            // Trigger explosion on hit OR failsafe depth
            if (hit || this.car.position.y < -200) {
                this.triggerExplosion();
            }
        }

        // Camera follow logic
        const timeSinceExplosion = this.explosionTriggered ? (this.clock.getElapsedTime() - this.explosionTime) : 0;
        
        this.cameraManager.updateCrashZoom(
            dt, 
            this.car.position, 
            this.explosionTriggered, 
            timeSinceExplosion, 
            this.trackManager,
            this.scene
        );
    }

    triggerExplosion() {
        this.explosionTriggered = true;
        this.explosionTime = this.clock.getElapsedTime();

        // Mark in recorder
        this.recorder.markExplosion();

        // Spawn Explosion at current car position
        const explosion = new Explosion(this.scene, this.car.position.clone());
        this.explosions.push(explosion);
        
        // Hide car mesh as it exploded
        this.car.hide();

        // Play explosion sound (repurposed skidSound)
        this.audioManager.playSkid(true);

        // Delay showing game over overlay so explosion is visible
        setTimeout(() => {
            this.showGameOverScreen();
        }, 5000); // Allow for full zoom out
    }

    async showGameOverScreen() {
        this.gameOverScreen.classList.remove('hidden');
        this.finalScoreEl.innerText = `Distance: ${Math.floor(this.distanceTraveled)}m`;

        // Stop recording
        const replayData = this.recorder.stop(this.trackManager);
        
        // Send High Score (Async upload)
        this.postHighScore(replayData);

        // Start Background Replay
        this.startBackgroundReplay(replayData);
    }

    async loadReplayFromURL(url) {
        try {
            this.audioManager.resumeContext();
            console.log("Loading replay from:", url);
            const response = await fetch(url);
            if (!response.ok) throw new Error("Network response was not ok");
            const data = await response.json();

            // Force reset to clear any current game state and setup scene
            this.reset();
            this.isRunning = false; // Stop game loop immediately, we only want replay
            
            // Hide UI elements
            const startScreen = document.getElementById('start-screen');
            if (startScreen) startScreen.classList.add('hidden');
            this.gameOverScreen.classList.add('hidden');
            if (this.uiLayer) this.uiLayer.style.display = 'none';

            this.startBackgroundReplay(data);
            this.replayLoaded = true;

            // Ensure loop is running if triggered from URL (bypassing start screen)
            if (!this.loopStarted) this.loop();

        } catch (e) {
            console.error("Failed to load replay:", e);
        }
    }

    startBackgroundReplay(data) {
        this.isCrashing = false;
        this.isRunning = false;
        this.isReplaying = true;
        
        // Reset effects
        while(this.explosions.length > 0) {
            const exp = this.explosions.pop();
            this.scene.remove(exp.mesh);
            this.scene.remove(exp.light);
        }
        this.car.mesh.visible = true; // Show car again
        
        this.replaySystem.load(data);
    }

    // Handle blue play button behavior in render= mode
    handleRenderPlayButton(url) {
        if (!this.replayLoaded) {
            // First time: load and start replay
            this.loadReplayFromURL(url);
        } else if (this.replaySystem) {
            // Already loaded: just resume from current frame
            this.replaySystem.isPlaying = true;
        }
    }

    async postHighScore(replayData) {
        try {
            let username = "Guest";
            let userid = "guest";
            
            if (this.room && this.room.clientId && this.room.peers) {
                const p = this.room.peers[this.room.clientId];
                if (p) {
                    username = p.username || "Guest";
                    userid = p.id || this.room.clientId;
                } else {
                    userid = this.room.clientId;
                }
            }

            // 1. Ensure Renderer Assets exist (HTML, CSS, JS)
            const assets = await this.ensureRendererAssets();

            // 2. Calculate Duration
            let totalTime = 0;
            if (replayData.frames) {
                totalTime = replayData.frames.reduce((acc, f) => acc + (f[11] || 0.016), 0);
            }
            const fps = 30;
            const durationInFrames = Math.ceil(totalTime * fps) + 30; // +1 sec buffer

            // 3. Construct the Manifest JSON
            // We embed the replayData into 'data' so the renderer doesn't need to fetch it again
            const manifest = {
                assets: {
                    html: assets.html,
                    css: assets.css,
                    js: assets.js
                },
                config: {
                    width: 1920,
                    height: 1080,
                    fps: fps,
                    durationInFrames: durationInFrames
                },
                data: {
                    baseUrl: window.location.origin + window.location.pathname.replace('index.html', ''),
                    replayData: replayData,
                    score: Math.floor(this.distanceTraveled),
                    username: username
                }
            };
            
            // Upload the Manifest
            const jsonString = JSON.stringify(manifest);
            const blob = new Blob([jsonString], { type: 'application/json' });
            const file = new File([blob], "render_manifest.json", { type: "application/json" });
            
            const manifestUrl = await websim.upload(file);

            const message = {
                userid: userid,
                username: username,
                score: [Math.floor(this.distanceTraveled), this.car.grappleCount],
                replay: manifestUrl // Point to the manifest, not just raw replay
            };

            if (window.parent) {
                window.parent.postMessage(message, '*');
                console.log("High Score Posted with Manifest URL", message);
            }

        } catch (e) {
            console.error("Error posting high score:", e);
        }
    }

    async ensureRendererAssets() {
        const ASSET_VERSION = 'v1_bundled'; 
        const COLLECTION_NAME = 'renderer_assets';
        
        try {
            // Check Creator's Cache
            const creator = await window.websim.getCreator();
            const records = await this.room.collection(COLLECTION_NAME).filter({ 
                version: ASSET_VERSION,
                created_by_username: creator.username 
            }).getList();

            const ownerRecord = records.find(r => r.username === creator.username);

            if (ownerRecord) {
                return {
                    html: ownerRecord.html_url,
                    css: ownerRecord.css_url,
                    js: ownerRecord.js_url
                };
            }

            console.log("Generating Renderer Assets Bundle...");

            // 1. Bundle JS
            const fileOrder = [
                'utils.js', 
                'track_factory.js',
                'track_generator.js',
                'track.js',
                'car_mesh.js',
                'car.js',
                'input_manager.js',
                'effects.js',
                'audio_manager.js',
                'camera_manager.js',
                'replay.js',
                'renderer.js'
            ];

            let bundledJs = `
import * as THREE from 'https://esm.sh/three@0.160.0';
import { EffectComposer } from 'https://esm.sh/three@0.160.0/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'https://esm.sh/three@0.160.0/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'https://esm.sh/three@0.160.0/examples/jsm/postprocessing/UnrealBloomPass.js';

// --- BUNDLED GAME LOGIC ---
`;

            for (const file of fileOrder) {
                const res = await fetch('./' + file);
                let text = await res.text();
                
                // Patch asset URLs to be absolute so they load on remote renderers
                text = text.replace(/'\.\/([^']+)'/g, (match, path) => {
                    if (path.match(/\.(png|mp3|jpg|jpeg|glb)$/i)) {
                        return `'${new URL(path, window.location.href).href}'`;
                    }
                    return match;
                });

                // Remove Imports
                text = text.replace(/import .* from .*/g, '');
                // Remove Exports
                text = text.replace(/export class/g, 'class');
                text = text.replace(/export function/g, 'function');
                
                bundledJs += `\n// --- ${file} ---\n${text}\n`;
            }

            // 2. Fetch CSS
            const cssRes = await fetch('./style.css');
            const cssText = await cssRes.text();

            // 3. Create HTML
            const htmlText = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Grapple Renderer</title>
</head>
<body>
    <div id="game-container"></div>
</body>
</html>`;

            // 4. Upload
            const uploads = await Promise.all([
                websim.upload(new File([new Blob([htmlText], {type: 'text/html'})], "renderer.html")),
                websim.upload(new File([new Blob([cssText], {type: 'text/css'})], "renderer.css")),
                websim.upload(new File([new Blob([bundledJs], {type: 'application/javascript'})], "renderer.js"))
            ]);

            const result = {
                html: uploads[0],
                css: uploads[1],
                js: uploads[2]
            };

            // 5. Save to DB if Creator
            const currentUser = await window.websim.getCurrentUser();
            if (currentUser.id === creator.id) {
                await this.room.collection(COLLECTION_NAME).create({
                    version: ASSET_VERSION,
                    html_url: result.html,
                    css_url: result.css,
                    js_url: result.js
                });
                console.log("Assets cached to DB");
            }

            return result;

        } catch (e) {
            console.error("Failed to ensure renderer assets:", e);
            return { html: "", css: "", js: "" };
        }
    }

    onWindowResize() {
        this.cameraManager.resize(window.innerWidth, window.innerHeight);
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.composer.setSize(window.innerWidth, window.innerHeight);
    }

    loop() {
        this.loopStarted = true;
        requestAnimationFrame(() => this.loop());

        const dt = Math.min(this.clock.getDelta(), 0.1); 

        // Update Explosions
        for (let i = this.explosions.length - 1; i >= 0; i--) {
            const exp = this.explosions[i];
            exp.update(dt);
            if (!exp.alive) {
                this.explosions.splice(i, 1);
            }
        }

        // Run Environment Update FIRST so ReplaySystem can override positions if needed
        if (this.spaceEnvironment) {
            // In replay mode, we want environment to update normally (stars, background asteroids),
            // but the interceptor will be strictly controlled by the replay system.
            this.spaceEnvironment.update(dt, this.camera.position);
        }

        if (this.isRunning) {
            // Update Logic
            this.car.update(dt, this.inputManager, this.trackManager);

            // Record Frame (with dt and interceptor)
            this.recorder.recordFrame(this.car, this.activeInterceptor, dt);

            // Check Track generation
            const distToHead = this.car.position.distanceTo(this.trackManager.currentPos);
            if (distToHead < 100) {
                this.trackManager.generateNextSegment();
            }

            // Check collision/Off-road
            if (!this.trackManager.isOnTrack(this.car.position)) {
                this.gameOver();
            }

            // Update Score
            this.distanceTraveled += this.car.speed * dt;
            this.scoreEl.innerText = `DISTANCE: ${Math.floor(this.distanceTraveled)}m`;
            this.grappleScoreEl.innerText = `GRAPPLES: ${this.car.grappleCount}`;

            // Camera Follow
            this.cameraManager.updateFollow(this.car.position, dt);

            // SFX Logic
            if(this.car.grappleState === 'FIRING') {
                this.audioManager.playGrapple();
            }
        } 
        else if (this.isCrashing) {
            this.updateCrash(dt);
            this.recorder.recordFrame(this.car, this.activeInterceptor, dt);
        }
        else if (this.isReplaying) {
            // Replay Mode
            this.replaySystem.update(dt);
        }

        this.composer.render();
    }
}