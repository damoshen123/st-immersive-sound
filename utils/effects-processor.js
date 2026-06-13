class EffectsProcessor {
    constructor() {
        this.audioBuffer = null;
        this.irBuffer = null;
        this.isPlaying = false;
        this.currentPlayer = null;
        this.currentNodes = [];
        this.animationFrameId = null;
        
        this.pathPoints = [];
        this.selectedPointIndex = -1;
        this.isDragging = false;
        this.dragView = null;

        this.currentSourcePosition = { x: 0, y: 0, z: -1.5 };
        this.isAnimating = false;
    }

    // --- Audio Export ---

    /**
     * Converts an AudioBuffer to a WAV file (Blob).
     * @param {AudioBuffer} buffer The AudioBuffer to convert.
     * @returns {Blob} A Blob representing the WAV file.
     */
    audioBufferToWav(buffer) {
        const numOfChan = buffer.numberOfChannels;
        const length = buffer.length * numOfChan * 2 + 44;
        const bufferArr = new ArrayBuffer(length);
        const view = new DataView(bufferArr);
        const channels = [];
        let i, sample;
        let offset = 0;
        let pos = 0;

        // Helper function to write strings
        const writeString = (s) => {
            for (i = 0; i < s.length; i++) {
                view.setUint8(pos++, s.charCodeAt(i));
            }
        };

        // WAV header
        writeString('RIFF');
        view.setUint32(pos, 36 + buffer.length * numOfChan * 2, true); pos += 4;
        writeString('WAVE');
        writeString('fmt ');
        view.setUint32(pos, 16, true); pos += 4;
        view.setUint16(pos, 1, true); pos += 2;
        view.setUint16(pos, numOfChan, true); pos += 2;
        view.setUint32(pos, buffer.sampleRate, true); pos += 4;
        view.setUint32(pos, buffer.sampleRate * 2 * numOfChan, true); pos += 4;
        view.setUint16(pos, numOfChan * 2, true); pos += 2;
        view.setUint16(pos, 16, true); pos += 2;
        writeString('data');
        view.setUint32(pos, buffer.length * numOfChan * 2, true); pos += 4;

        // Write interleaved data
        for (i = 0; i < buffer.numberOfChannels; i++) {
            channels.push(buffer.getChannelData(i));
        }

        while (pos < length) {
            for (i = 0; i < numOfChan; i++) {
                sample = Math.max(-1, Math.min(1, channels[i][offset])); // Clamp
                sample = (0.5 + sample < 0 ? sample * 32768 : sample * 32767) | 0; // To 16-bit signed int
                view.setInt16(pos, sample, true);
                pos += 2;
            }
            offset++;
        }

        return new Blob([view], { type: 'audio/wav' });
    }

    async exportAudio(settings, format = 'wav') {
        if (!this.audioBuffer) {
            throw new Error("没有加载用于导出的音频文件。");
        }

        const duration = this.audioBuffer.duration;

        const renderedBuffer = await Tone.Offline(async (offlineContext) => {
            // In offline context, Tone.getDestination() is the offline buffer
            const destination = offlineContext.destination;

            const player = new Tone.Player(this.audioBuffer);
            const chain = await this.buildProcessingChain(settings);

            // Handle spatial animation with automation
            const panner = chain.find(node => node instanceof Tone.Panner3D);
            if (panner && this.pathPoints.length > 1) {
                let currentTime = 0;
                for (let i = 0; i < this.pathPoints.length - 1; i++) {
                    const from = this.pathPoints[i];
                    const to = this.pathPoints[i + 1];

                    // Set starting point of the segment
                    panner.positionX.setValueAtTime(from.x, currentTime);
                    panner.positionY.setValueAtTime(from.y, currentTime);
                    panner.positionZ.setValueAtTime(from.z, currentTime);
                    
                    // Handle dwell time at the 'from' point
                    const dwellTime = from.dwellTime || 0;
                    if (dwellTime > 0) {
                        currentTime += dwellTime;
                        // Keep position constant during dwell
                        panner.positionX.setValueAtTime(from.x, currentTime);
                        panner.positionY.setValueAtTime(from.y, currentTime);
                        panner.positionZ.setValueAtTime(from.z, currentTime);
                    }

                    // Calculate movement duration
                    const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
                    const segmentLength = Math.sqrt(dx*dx + dy*dy + dz*dz);
                    const speed = from.speedToNext || 1;
                    const duration = (segmentLength > 0 && speed > 0) ? segmentLength / speed : 0;

                    // Schedule linear ramp to the next point
                    if (duration > 0) {
                        panner.positionX.linearRampToValueAtTime(to.x, currentTime + duration);
                        panner.positionY.linearRampToValueAtTime(to.y, currentTime + duration);
                        panner.positionZ.linearRampToValueAtTime(to.z, currentTime + duration);
                        currentTime += duration;
                    } else { // If no duration, jump instantly
                        panner.positionX.setValueAtTime(to.x, currentTime);
                        panner.positionY.setValueAtTime(to.y, currentTime);
                        panner.positionZ.setValueAtTime(to.z, currentTime);
                    }
                }
            }

            // Connect the chain
            if (chain.length > 0) {
                const firstNode = chain[0];
                player.connect(firstNode.isIRProcessor ? firstNode.input : firstNode);
                for (let i = 0; i < chain.length - 1; i++) {
                    this.connectNodes(chain[i], chain[i + 1]);
                }
                const lastNode = chain[chain.length - 1];
                if (lastNode.isIRProcessor) {
                    lastNode.output.connect(destination);
                } else {
                    lastNode.connect(destination);
                }
            } else {
                player.connect(destination);
            }

            player.start(0);

        }, duration);

        if (format === 'wav') {
            return this.audioBufferToWav(renderedBuffer);
        } else {
            // Placeholder for MP3 conversion
            throw new Error("MP3 导出功能尚未实现。");
        }
    }


    async previewOriginal() {
        if (!this.audioBuffer) {
            console.warn("Preview original audio failed: audioBuffer is null.");
            return;
        }
        await this.stopPlayback();
        await Tone.start();
        const player = new Tone.Player(this.audioBuffer).toDestination();
        this.currentPlayer = player;
        player.start();
        this.isPlaying = true;
        player.onstop = () => {
            // This can be simplified, as stopPlayback handles all cleanup
            this.stopPlayback();
        };
    }

    async handleAudioFile(file) {
        if (!file) return;
        await Tone.start();
        const arrayBuffer = await file.arrayBuffer();
        this.audioBuffer = await Tone.context.decodeAudioData(arrayBuffer);
        return this.audioBuffer;
    }

    async handleIRFile(file) {
        if (!file) return;
        await Tone.start();
        const arrayBuffer = await file.arrayBuffer();
        this.irBuffer = await Tone.context.decodeAudioData(arrayBuffer);
        return this.irBuffer;
    }

    async loadIrFromBase64(base64String) {
        // This function is now deprecated for general use but kept for potential legacy compatibility.
        // The primary method is now loadIr(fileName).
        if (!base64String) {
            this.irBuffer = null;
            return null;
        }
        try {
            const response = await fetch(base64String);
            const arrayBuffer = await response.arrayBuffer();
            await Tone.start();
            this.irBuffer = await Tone.context.decodeAudioData(arrayBuffer);
            return this.irBuffer;
        } catch (error) {
            console.error("Failed to load IR from Base64:", error);
            this.irBuffer = null;
            return null;
        }
    }

    async loadIr(fileName) {
        if (!fileName) {
            this.irBuffer = null;
            return null;
        }
        try {
            // Use the new caching mechanism
            const { loadIrBufferWithCache } = await import('./ir-cache.js');
            this.irBuffer = await loadIrBufferWithCache(fileName);
            return this.irBuffer;
        } catch (error) {
            console.error(`[st-immersive-sound] Failed to load IR file "${fileName}" for preview:`, error);
            //toastr.error(`试听时加载环境混响文件失败: ${fileName}`);
            this.irBuffer = null;
            return null;
        }
    }

    async buildProcessingChain(settings, options = {}) {
        const chain = [];
        const compSettings = {
            enabled: false,
            threshold: -24,
            ratio: 12,
            attack: 3,
            release: 250,
            makeup: 0,
            ...(settings?.compressor || {})
        };
        const fxSettings = {
            enabled: false,
            pitch: { enabled: false, shift: 0, grainSize: 'medium', ...((settings?.effects || {}).pitch || {}) },
            filter: {
                enabled: false,
                highpass: { enabled: false, freq: 80, q: 1, ...(((settings?.effects || {}).filter || {}).highpass || {}) },
                lowpass: { enabled: false, freq: 12000, q: 1, ...(((settings?.effects || {}).filter || {}).lowpass || {}) },
                ...((settings?.effects || {}).filter || {})
            },
            distortion: { enabled: false, amount: 0, type: 'soft', ...((settings?.effects || {}).distortion || {}) },
            chorus: { enabled: false, depth: 0, rate: 1.5, wet: 0, ...((settings?.effects || {}).chorus || {}) },
            delay: { enabled: false, time: 250, feedback: 30, wet: 0, ...((settings?.effects || {}).delay || {}) },
            reverb: { enabled: false, decay: 1.5, predelay: 10, wet: 0, ...((settings?.effects || {}).reverb || {}) },
            ...(settings?.effects || {})
        };
        fxSettings.filter.highpass = { enabled: false, freq: 80, q: 1, ...(fxSettings.filter.highpass || {}) };
        fxSettings.filter.lowpass = { enabled: false, freq: 12000, q: 1, ...(fxSettings.filter.lowpass || {}) };
        const irSettings = {
            enabled: false,
            wet: 50,
            gain: 0,
            fileName: '',
            ...(settings?.ir || {})
        };
        const spatialSettings = {
            enabled: false,
            params: {},
            points: [],
            ...(settings?.spatial || {})
        };
        const { irProfileName } = options;

        // Compressor
        if (compSettings.enabled) {
            const compressor = new Tone.Compressor({
                threshold: compSettings.threshold,
                ratio: compSettings.ratio,
                attack: compSettings.attack / 1000,
                release: compSettings.release / 1000
            });
            chain.push(compressor);

            const makeup = new Tone.Gain(Math.pow(10, compSettings.makeup / 20));
            chain.push(makeup);
        }

        // Effects
        if (fxSettings.enabled) {
            if (fxSettings.pitch.enabled) {
                const windowSizes = { small: 0.03, medium: 0.1, large: 0.2 };
                const pitchShift = new Tone.PitchShift({
                    pitch: fxSettings.pitch.shift,
                    windowSize: windowSizes[fxSettings.pitch.grainSize] || 0.1
                });
                chain.push(pitchShift);
            }

            if (fxSettings.filter.enabled) {
                if (fxSettings.filter.highpass.enabled) {
                    const highpass = new Tone.Filter({
                        frequency: fxSettings.filter.highpass.freq,
                        type: 'highpass',
                        Q: fxSettings.filter.highpass.q
                    });
                    chain.push(highpass);
                }
                if (fxSettings.filter.lowpass.enabled) {
                    const lowpass = new Tone.Filter({
                        frequency: fxSettings.filter.lowpass.freq,
                        type: 'lowpass',
                        Q: fxSettings.filter.lowpass.q
                    });
                    chain.push(lowpass);
                }
            }

            if (fxSettings.distortion.enabled) {
                const distortion = new Tone.Distortion({
                    distortion: fxSettings.distortion.amount / 100,
                    oversample: fxSettings.distortion.type === 'soft' ? '4x' : 'none'
                });
                chain.push(distortion);
            }

            if (fxSettings.chorus.enabled) {
                const chorus = new Tone.Chorus({
                    depth: fxSettings.chorus.depth / 100,
                    frequency: fxSettings.chorus.rate,
                    wet: fxSettings.chorus.wet / 100
                }).start();
                chain.push(chorus);
            }

            if (fxSettings.delay.enabled) {
                const delay = new Tone.FeedbackDelay({
                    delayTime: fxSettings.delay.time / 1000,
                    feedback: fxSettings.delay.feedback / 100,
                    wet: fxSettings.delay.wet / 100
                });
                chain.push(delay);
            }

            if (fxSettings.reverb.enabled) {
                const reverb = new Tone.Reverb({
                    decay: fxSettings.reverb.decay,
                    preDelay: fxSettings.reverb.predelay / 1000,
                    wet: fxSettings.reverb.wet / 100
                });
                await reverb.generate();
                chain.push(reverb);
            }
        }

        // IR Reverb
        // For UI preview, we load the IR on demand.
        if (irSettings.enabled) {
            if (irProfileName) {
                await this.loadIr(`${irProfileName}.wav`);
            }
            // The actual playback chain (playback-node-manager) will handle its own loading.
            // This part is primarily for the UI "Listen" feature.
        }

        if (irSettings.enabled && this.irBuffer) {
            const wetAmount = irSettings.wet / 100;
            const dryAmount = 1 - wetAmount;
            const gainAmount = Math.pow(10, (irSettings.gain || 0) / 20);

            // Use Tone.Convolver which is a wrapper around the native node
            const convolver = new Tone.Convolver(this.irBuffer);
            
            // Manually implement the dry/wet mix
            const inputGain = new Tone.Gain(1);
            const dryGain = new Tone.Gain(dryAmount * gainAmount);
            const wetGain = new Tone.Gain(wetAmount * gainAmount);
            const outputGain = new Tone.Gain(1);

            // Dry path
            inputGain.connect(dryGain);
            dryGain.connect(outputGain);
            
            // Wet path
            inputGain.connect(convolver);
            convolver.connect(wetGain);
            wetGain.connect(outputGain);

            chain.push({
                input: inputGain,
                output: outputGain,
                isIRProcessor: true,
                _nodes: [inputGain, dryGain, wetGain, convolver, outputGain],
                dispose: function() {
                    this._nodes.forEach(n => { 
                        try { n.dispose(); } catch(e) {} 
                    });
                }
            });
        }

        // Spatial Audio
        if (spatialSettings.enabled) {
            // HRTF headroom: 头相关函数对窄带（1-4 kHz）信号会产生 +3~+5 dB 的瞬时峰值放大，
            // 在 Panner3D 之前固定衰减 ≈ -3 dB，避免下游限幅器追不上 HRTF 卷积产生的单样本尖峰。
            const hrtfHeadroom = new Tone.Gain(0.7);
            chain.push(hrtfHeadroom);

            const panner = new Tone.Panner3D({
                panningModel: 'HRTF',
                ...spatialSettings.params
            });

            const points = this.pathPoints.length > 0 ? this.pathPoints : spatialSettings.points;
            if (points.length > 0) {
                panner.positionX.value = points[0].x;
                panner.positionY.value = points[0].y;
                panner.positionZ.value = points[0].z;
                this.currentSourcePosition = { ...points[0] };
            } else {
                panner.positionX.value = 0;
                panner.positionY.value = 0;
                panner.positionZ.value = -1.5;
                this.currentSourcePosition = { x: 0, y: 0, z: -1.5 };
            }
            chain.push(panner);
        }

        return chain;
    }

    connectNodes(source, target) {
        const sourceOutput = source.isIRProcessor ? source.output : source;
        const targetInput = target.isIRProcessor ? target.input : target;
        if (typeof sourceOutput.connect === 'function') {
            sourceOutput.connect(targetInput);
        }
    }

    connectToDestination(node, limiter) {
        const sink = limiter || Tone.getContext().destination;
        if (node.isIRProcessor) {
            node.output.connect(sink);
        } else if (typeof node.connect === 'function') {
            node.connect(sink);
        }
    }

    async playWithChain(chain, onSpatialUpdate) {
        await this.stopPlayback();
        await Tone.start();

        const player = new Tone.Player(this.audioBuffer);
        this.currentPlayer = player;

        // 砖墙限幅器：防止 IR + HRTF + 多效果叠加导致的削顶（破音）
        // attack 与主链 masterLimiter 对齐（1 ms），尽量截住 HRTF 卷积的单样本尖峰
        const limiter = new Tone.Compressor({
            threshold: -1,
            ratio: 20,
            knee: 0,
            attack: 0.001,
            release: 0.05,
        }).toDestination();
        this.currentNodes = [...chain, limiter];

        if (chain.length > 0) {
            const firstNode = chain[0];
            if (firstNode.isIRProcessor) {
                player.connect(firstNode.input);
            } else {
                player.connect(firstNode);
            }
            
            for (let i = 0; i < chain.length - 1; i++) {
                this.connectNodes(chain[i], chain[i + 1]);
            }
            
            this.connectToDestination(chain[chain.length - 1], limiter);
        } else {
            player.connect(limiter);
        }

        const panner = chain.find(node => node instanceof Tone.Panner3D);
        if (panner && this.pathPoints.length > 1) {
            this.startSpatialAnimation(panner, onSpatialUpdate);
        }

        player.start();
        this.isPlaying = true;
        player.onstop = () => this.stopPlayback();
    }

    async stopPlayback() {
        this.isPlaying = false;
        this.isAnimating = false;

        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }

        if (this.currentPlayer) {
            try { this.currentPlayer.stop(); this.currentPlayer.dispose(); } catch (e) {}
            this.currentPlayer = null;
        }

        this.currentNodes.forEach(node => {
            try {
                if (typeof node.dispose === 'function') node.dispose();
                else if (typeof node.disconnect === 'function') node.disconnect();
            } catch (e) {}
        });
        this.currentNodes = [];
    }

    startSpatialAnimation(panner, onUpdateCallback) {
        // Handle paths with 0 or 1 points
        if (this.pathPoints.length === 0) {
            return; // Nothing to do
        }
        if (this.pathPoints.length === 1) {
            const point = this.pathPoints[0];
            this.currentSourcePosition = { ...point };
            panner.positionX.value = point.x;
            panner.positionY.value = point.y;
            panner.positionZ.value = point.z;
            if (onUpdateCallback) onUpdateCallback();
            return;
        }

        let currentPointIndex = 0;
        let segmentProgress = 0;
        let lastTime = performance.now();
        this.isAnimating = true;

        // State machine: 'DWELLING' or 'MOVING'
        let state = 'DWELLING';
        // Start by dwelling at the first point
        let dwellTimer = this.pathPoints[0].dwellTime || 0;

        // Set initial position
        this.currentSourcePosition = { ...this.pathPoints[0] };
        panner.positionX.value = this.currentSourcePosition.x;
        panner.positionY.value = this.currentSourcePosition.y;
        panner.positionZ.value = this.currentSourcePosition.z;
        if (onUpdateCallback) onUpdateCallback();

        const animate = (currentTime) => {
            if (!this.isAnimating || !this.isPlaying) return;

            const deltaTime = (currentTime - lastTime) / 1000;
            lastTime = currentTime;

            if (state === 'DWELLING') {
                dwellTimer -= deltaTime;
                if (dwellTimer <= 0) {
                    // Finished dwelling. Check if we are at the last point.
                    if (currentPointIndex >= this.pathPoints.length - 1) {
                        this.isAnimating = false; // Animation ends after dwelling at the last point.
                        return;
                    }
                    // Not at the end, so start moving to the next point.
                    state = 'MOVING';
                    segmentProgress = 0;
                }
            } 
            
            if (state === 'MOVING') {
                const from = this.pathPoints[currentPointIndex];
                const to = this.pathPoints[currentPointIndex + 1];
                const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
                const segmentLength = Math.sqrt(dx*dx + dy*dy + dz*dz);
                const speed = from.speedToNext || 1;
                
                if (segmentLength > 0 && speed > 0) {
                    segmentProgress += deltaTime / (segmentLength / speed);
                } else {
                    segmentProgress = 1; // Instantly complete zero-length or zero-speed segments
                }

                if (segmentProgress >= 1) {
                    // Arrived at the next point ('to')
                    this.currentSourcePosition = { ...to };
                    currentPointIndex++; // We are now at the point indexed by `currentPointIndex`
                    
                    // Start dwelling at the new point
                    state = 'DWELLING';
                    dwellTimer = this.pathPoints[currentPointIndex].dwellTime || 0;

                } else {
                    // In transit
                    const t = Math.min(segmentProgress, 1);
                    this.currentSourcePosition.x = from.x + (to.x - from.x) * t;
                    this.currentSourcePosition.y = from.y + (to.y - from.y) * t;
                    this.currentSourcePosition.z = from.z + (to.z - from.z) * t;
                }
            }

            // Update panner position regardless of state
            // Use rampTo for smoother and more reliable updates in the audio thread
            const rampTime = 0.05; // A short ramp time to avoid clicks but still be responsive
            panner.positionX.rampTo(this.currentSourcePosition.x, rampTime);
            panner.positionY.rampTo(this.currentSourcePosition.y, rampTime);
            panner.positionZ.rampTo(this.currentSourcePosition.z, rampTime);

            if (onUpdateCallback) {
                onUpdateCallback();
            }

            if (this.isAnimating) {
                this.animationFrameId = requestAnimationFrame(animate);
            }
        };

        this.animationFrameId = requestAnimationFrame(animate);
    }
}

export const effectsProcessor = new EffectsProcessor();
