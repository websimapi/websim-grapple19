import * as THREE from 'https://esm.sh/three@0.160.0';
import { EffectComposer } from 'https://esm.sh/three@0.160.0/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'https://esm.sh/three@0.160.0/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'https://esm.sh/three@0.160.0/examples/jsm/postprocessing/UnrealBloomPass.js';

window.ReplayRenderer = {
    async init(rootElement, data) {
        this.root = rootElement;
        this.data = data;

        // Determine Base URL for loading other modules
        // data.baseUrl should be passed from the game, pointing to the project root
        this.baseUrl = data.baseUrl || window.location.origin + window.location.pathname.replace('index.html', '');
        if (!this.baseUrl.endsWith('/')) this.baseUrl += '/';

        // Setup DOM
        this.container = document.createElement('div');
        this.container.id = 'game-container';
        this.container.style.width = '100%';
        this.container.style.height = '100%';
        this.root.appendChild(this.container);

        // Dynamic Imports of Game Logic
        // We load them from the provided baseUrl to ensure we get the correct version of the game code
        try {
            const [
                { Car },
                { TrackManager },
                { ReplaySystem },
                { SpaceEnvironment },
                { AudioManager },
                { CameraManager }
            ] = await Promise.all([
                import(this.baseUrl + 'car.js'),
                import(this.baseUrl + 'track.js'),
                import(this.baseUrl + 'replay.js'),
                import(this.baseUrl + 'effects.js'),
                import(this.baseUrl + 'audio_manager.js'),
                import(this.baseUrl + 'camera_manager.js')
            ]);

            // Setup THREE Scene
            this.scene = new THREE.Scene();
            this.scene.fog = new THREE.FogExp2(0x050505, 0.002);

            // Camera
            this.cameraManager = new CameraManager();
            this.camera = this.cameraManager.camera;

            // Config check
            const width = data.config ? data.config.width : 1920;
            const height = data.config ? data.config.height : 1080;

            this.cameraManager.resize(width, height);

            // Renderer
            this.renderer = new THREE.WebGLRenderer({ 
                antialias: false,
                preserveDrawingBuffer: true,
                alpha: true
            });
            this.renderer.setSize(width, height);
            this.renderer.setPixelRatio(1);
            this.container.appendChild(this.renderer.domElement);

            // Post Processing
            this.composer = new EffectComposer(this.renderer);
            this.composer.addPass(new RenderPass(this.scene, this.camera));

            const bloomPass = new UnrealBloomPass(new THREE.Vector2(width, height), 1.5, 0.4, 0.85);
            bloomPass.threshold = 0.1;
            bloomPass.strength = 1.2; 
            bloomPass.radius = 0.5;
            this.composer.addPass(bloomPass);

            // Lights
            const ambientLight = new THREE.AmbientLight(0xffffff, 2.5);
            this.scene.add(ambientLight);
            const hemiLight = new THREE.HemisphereLight(0x88aaff, 0x222244, 1.2);
            this.scene.add(hemiLight);
            const dirLight = new THREE.DirectionalLight(0xffffff, 1.5);
            dirLight.position.set(20, 40, 10);
            this.scene.add(dirLight);

            // Game Objects
            this.spaceEnvironment = new SpaceEnvironment(this.scene);
            this.trackManager = new TrackManager(this.scene);
            this.car = new Car(this.scene);

            // Mock Audio Manager (Audio not needed for rendering visuals, usually)
            const mockAudio = {
                playEngine: () => {},
                stopEngine: () => {},
                playGrapple: () => {},
                playSkid: () => {},
                resumeContext: () => {}
            };

            this.replaySystem = new ReplaySystem(
                this.car, 
                this.trackManager, 
                this.cameraManager, 
                this.scene, 
                this.spaceEnvironment, 
                mockAudio
            );

            // Load Replay
            if (data.replayData) {
                this.replaySystem.load(data.replayData);
                this.replaySystem.update(0); // Init state
            }

            this.lastFrame = -1;

        } catch (e) {
            console.error("Renderer Init Failed:", e);
        }
    },

    render(frame, fps, duration) {
        if (!this.replaySystem) return;

        // Ensure sequential playback for simulation consistency
        const dt = 1 / fps;

        if (frame === 0 || frame < this.lastFrame) {
            this.replaySystem.resetLoop();
            this.lastFrame = -1;
        }

        // Advance simulation from lastFrame to current frame
        // This handles dropped frames during rendering if any
        let framesToSimulate = frame - this.lastFrame;

        // Safety cap to prevent freezing if huge jump
        if (framesToSimulate > 10) {
            this.replaySystem.resetLoop();
            framesToSimulate = frame; // Start from 0
            // Actually, if we reset, we need to sim from 0 to frame
            // That might be too heavy. 
            // Ideally the renderer calls frames sequentially.
        }

        for (let i = 0; i < framesToSimulate; i++) {
            this.replaySystem.update(dt);
        }

        this.lastFrame = frame;
        this.composer.render();
    },

    cleanup() {
        if (this.renderer) {
            this.renderer.dispose();
            this.renderer.domElement.remove();
        }
        // Additional cleanup if needed
    }
};