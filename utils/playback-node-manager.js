import { extension_settings } from "../../../../extensions.js";
import { extensionName } from './config.js';
import { loadIrBufferWithCache } from './ir-cache.js';

/**
 * 检查效果配置是否有任何启用的效果
 */
function hasActiveEffects(fxSettings) {
    if (!fxSettings || typeof fxSettings !== 'object') return false;
    
    if (fxSettings.pitch?.enabled) return true;
    if (fxSettings.distortion?.enabled) return true;
    if (fxSettings.chorus?.enabled) return true;
    if (fxSettings.delay?.enabled) return true;
    if (fxSettings.reverb?.enabled) return true;
    if (fxSettings.filter?.enabled) {
        if (fxSettings.filter.highpass?.enabled || fxSettings.filter.lowpass?.enabled) {
            return true;
        }
    }
    
    return false;
}

/**
 * 检查 IR 配置是否有效（有文件名）
 */
function hasValidIR(irSettings) {
    return irSettings && typeof irSettings.fileName === 'string' && irSettings.fileName.trim() !== '';
}

/**
 * 检查压缩器配置是否有效
 */
function hasValidCompressor(compSettings) {
    return compSettings && 
           compSettings.threshold !== undefined && 
           compSettings.ratio !== undefined && 
           compSettings.ratio > 1;
}

export async function createPlaybackChain(settings) {
    if (!settings.audioBuffer) {
        console.error("[st-immersive-sound] createPlaybackChain failed: audioBuffer is required.");
        return null;
    }

    await Tone.start();

    const allSettings = extension_settings[extensionName];
    const effectsEnabled = allSettings.effectsProcessor?.effectsEnabled || {};
    const irApplyToVoiceOnly = allSettings.effectsProcessor?.irApplyToVoiceOnly || false;
    
   // console.log(`[st-immersive-sound] createPlaybackChain for irApplyToVoiceOnly`,irApplyToVoiceOnly);

    const player = new Tone.Player(settings.audioBuffer);
    player.loop = settings.loop || false;

    const nodes = [];
    let panner = null;
    const { type, compressor: compSettings, effects: fxSettings, ir: irSettings, spatial: spatialSettings } = settings;

    // 1. Compressor - 只有配置有效时才创建
    if (effectsEnabled.compressor && hasValidCompressor(compSettings)) {
        const compressor = new Tone.Compressor({
            threshold: compSettings.threshold,
            ratio: compSettings.ratio,
            attack: compSettings.attack / 1000,
            release: compSettings.release / 1000
        });
        nodes.push(compressor);

        if (compSettings.makeup && compSettings.makeup !== 0) {
            const makeup = new Tone.Gain(Math.pow(10, compSettings.makeup / 20));
            nodes.push(makeup);
        }
    }

    // 2. Effects - 只有存在启用的效果时才处理
    if (effectsEnabled.effects && hasActiveEffects(fxSettings)) {
        
        if (fxSettings.pitch?.enabled) {
            const windowSizes = { small: 0.03, medium: 0.1, large: 0.2 };
            nodes.push(new Tone.PitchShift({
                pitch: fxSettings.pitch.shift,
                windowSize: windowSizes[fxSettings.pitch.grainSize] || 0.1
            }));
        }

        if (fxSettings.filter?.enabled) {
            if (fxSettings.filter.highpass?.enabled) {
                nodes.push(new Tone.Filter({
                    frequency: fxSettings.filter.highpass.freq,
                    type: 'highpass',
                    Q: fxSettings.filter.highpass.q
                }));
            }
            if (fxSettings.filter.lowpass?.enabled) {
                nodes.push(new Tone.Filter({
                    frequency: fxSettings.filter.lowpass.freq,
                    type: 'lowpass',
                    Q: fxSettings.filter.lowpass.q
                }));
            }
        }
        
        if (fxSettings.distortion?.enabled) {
            nodes.push(new Tone.Distortion({
                distortion: fxSettings.distortion.amount / 100,
                oversample: fxSettings.distortion.type === 'soft' ? '4x' : 'none'
            }));
        }

        if (fxSettings.chorus?.enabled) {
            nodes.push(new Tone.Chorus({
                depth: fxSettings.chorus.depth / 100,
                frequency: fxSettings.chorus.rate,
                wet: fxSettings.chorus.wet / 100
            }).start());
        }

        if (fxSettings.delay?.enabled) {
            nodes.push(new Tone.FeedbackDelay({
                delayTime: fxSettings.delay.time / 1000,
                feedback: fxSettings.delay.feedback / 100,
                wet: fxSettings.delay.wet / 100
            }));
        }

        if (fxSettings.reverb?.enabled) {
            const reverb = new Tone.Reverb({
                decay: fxSettings.reverb.decay,
                preDelay: fxSettings.reverb.predelay / 1000,
                wet: fxSettings.reverb.wet / 100
            });
            await reverb.generate();
            nodes.push(reverb);
        }
    }

    // 3. IR Reverb - 根据规则创建
    const shouldApplyIr = effectsEnabled.ir && hasValidIR(irSettings) && (!irApplyToVoiceOnly || type === 'VOICE');
    if (shouldApplyIr) {
        const irBuffer = await loadIrBufferWithCache(irSettings.fileName);
        if (irBuffer) {
            const wetAmount = irSettings.wet / 100;
            const dryAmount = 1 - wetAmount;
            const gainAmount = Math.pow(10, (irSettings.gain || 0) / 20);

            const convolver = new Tone.Convolver(irBuffer);
            
            const inputGain = new Tone.Gain(1);
        const dryGain = new Tone.Gain(dryAmount * gainAmount);
        const wetGain = new Tone.Gain(wetAmount * gainAmount);
        const outputGain = new Tone.Gain(1);

        inputGain.connect(dryGain);
        dryGain.connect(outputGain);
        inputGain.connect(convolver);
        convolver.connect(wetGain);
        wetGain.connect(outputGain);

            nodes.push({
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
    }

    // 4. Spatial Audio - 只有启用且有点位时才创建
    let isSpatialEnabled = false;
    if (type === 'Music' || type === 'Ambiance') {
        const typeKey = type.toLowerCase();
        isSpatialEnabled = allSettings[`enable3dAudio_${typeKey}`];
    } else {
        isSpatialEnabled = effectsEnabled.spatial;
    }

    if (isSpatialEnabled && spatialSettings?.points?.length > 0) {
        // HRTF headroom: 头相关函数对窄带（1-4 kHz）信号会产生 +3~+5 dB 的瞬时峰值放大，
        // 在 Panner3D 之前固定衰减 ≈ -3 dB，避免下游限幅器追不上 HRTF 卷积产生的单样本尖峰。
        const hrtfHeadroom = new Tone.Gain(0.7);
        nodes.push(hrtfHeadroom);

        panner = new Tone.Panner3D({
            panningModel: 'HRTF',
            ...spatialSettings.params
        });
        
        const points = spatialSettings.points;
        panner.setPosition(points[0].x, points[0].y, points[0].z);
        nodes.push(panner);
    }

    // 连接节点链
    if (nodes.length > 0) {
        let prevNode = player;
        for (const currentNode of nodes) {
            const sourceOutput = prevNode.isIRProcessor ? prevNode.output : prevNode;
            const targetInput = currentNode.isIRProcessor ? currentNode.input : currentNode;
            sourceOutput.connect(targetInput);
            prevNode = currentNode;
        }
    }

    const lastNode = nodes.length > 0 ? nodes[nodes.length - 1] : null;
    const output = lastNode ? (lastNode.isIRProcessor ? lastNode.output : lastNode) : player;

    return {
        player,
        nodes,
        panner,
        output,
        pathPoints: spatialSettings?.points || [],
        dispose: () => {
            try {
                if (player) player.dispose();
                nodes.forEach(node => {
                    if (node?.dispose) node.dispose();
                });
            } catch (e) {
                console.error("[st-immersive-sound] Error during chain disposal:", e);
            }
        }
    };
}
