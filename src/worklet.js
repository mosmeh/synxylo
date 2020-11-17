// stmlib's Svf called with FILTER_MODE_LOW_PASS
// https://github.com/pichenettes/stmlib/blob/master/dsp/filter.h
class StmLowpassFilter {
    constructor() {
        this._state1 = this._state2 = 0;
        this._g = this._r = this._h = 0;
    }
    setParams(freq, resonance) {
        this._g = Math.tan(Math.PI * freq);
        this._r = 1 / resonance;
        this._h = 1 / (1 + this._r * this._g + this._g * this._g);
    }
    process(x) {
        const hp =
            (x -
                this._r * this._state1 -
                this._g * this._state1 -
                this._state2) *
            this._h;
        const bp = this._g * hp + this._state1;
        this._state1 = this._g * hp + bp;
        const lp = this._g * bp + this._state2;
        this._state2 = this._g * bp + lp;
        return lp;
    }
}

// Based on Csound's mode
// https://github.com/csound/csound/blob/develop/Opcodes/biquad.c
class ModeFilter {
    constructor() {
        this._xnm1 = this._ynm1 = this._ynm2 = 0;
        this._a0 = this._a1 = this._a2 = this._d = 0;
        this._limit = sampleRate * (1 / Math.PI - 0.01);
    }
    setParams(freq, q) {
        const fq = Math.min(freq, this._limit);
        const alpha = sampleRate / (fq * 2 * Math.PI);
        const beta = alpha * alpha;
        this._d = 0.5 * alpha;
        this._a0 = 1 / (beta + this._d / q);
        this._a1 = this._a0 * (1 - 2 * beta);
        this._a2 = this._a0 * (beta - this._d / q);
    }
    process(x) {
        const yn =
            this._a0 * this._xnm1 -
            this._a1 * this._ynm1 -
            this._a2 * this._ynm2;
        this._xnm1 = x;
        this._ynm2 = this._ynm1;
        this._ynm1 = yn;
        return yn * this._d;
    }
}

// Exciter and Resonator are based on Mutable Instruments' Elements
// https://github.com/pichenettes/eurorack/tree/master/elements

// strike generator with mallet model
class Exciter {
    constructor() {
        this._filter = new StmLowpassFilter();
        this._amp = 0;
    }
    setStiffness(stiffness) {
        // stiffness := timbre

        const freq = (32 * Math.pow(10, 2.7 * stiffness)) / sampleRate;
        this._filter.setParams(freq, 0.5);
    }
    strike(amp) {
        this._amp = amp;
    }
    process() {
        const y = this._filter.process(this._amp);
        this._amp = 0;
        return y;
    }
}

// "Xylophone" in http://www.csounds.com/manual/html/MiscModalFreq.html
const MODAL_FREQ_RATIOS = [1, 3.932, 9.538, 16.688, 24.566, 31.147];

class Resonator {
    constructor() {
        this._filters = [];
        this._amplitudes = new Float32Array(MODAL_FREQ_RATIOS.length);
        for (let i = 0; i < MODAL_FREQ_RATIOS.length; ++i) {
            this._filters.push(new ModeFilter());
            this._amplitudes[i] = 1;
        }
    }
    setParams({ baseFreq, decay, material, position }) {
        // decay := damping
        // material := brightness

        let q = 5 * Math.pow(10, 4 * 0.8 * decay);
        const qLoss = material * (2.0 - material) * 0.85 + 0.15;

        for (let i = 0; i < MODAL_FREQ_RATIOS.length; ++i) {
            let freq = MODAL_FREQ_RATIOS[i] * baseFreq;
            // avoid aliasing
            while (freq > sampleRate / 2) {
                freq /= 2;
            }
            this._filters[i].setParams(freq, q);
            q *= qLoss;

            const k = Math.round(MODAL_FREQ_RATIOS[i] - 1);
            this._amplitudes[i] =
                (1 + Math.cos(2 * Math.PI * position * k)) / 2;
        }
    }
    process(x) {
        let y = 0;
        for (let i = 0; i < MODAL_FREQ_RATIOS.length; ++i) {
            y += this._amplitudes[i] * this._filters[i].process(x);
        }
        return y;
    }
}

class Voice {
    constructor(note) {
        this.note = note;
        this._freq = 440 * Math.pow(2, (note - 69) / 12);
        this._exciter = new Exciter();
        this._resonator = new Resonator();
    }
    setParams(params) {
        this._exciter.setStiffness(params.stiffness);
        this._resonator.setParams({
            ...params,
            baseFreq: this._freq,
        });
    }
    strike(velocity) {
        this._exciter.strike(velocity / 127);
    }
    process() {
        return this._resonator.process(this._exciter.process());
    }
}

class Processor extends AudioWorkletProcessor {
    constructor() {
        super();

        this._voices = [];
        this.port.onmessage = (e) => {
            const { data } = e;
            switch (data.type) {
                case 'setParams':
                    this._params = data.params;
                    while (this._voices.length > this._params.voices) {
                        this._voices.shift();
                    }
                    this._voices.forEach((voice) =>
                        voice.setParams(this._params)
                    );
                    return;
                case 'noteOn':
                    const i = this._voices.findIndex(
                        (voice) => voice.note === data.note
                    );
                    if (i >= 0) {
                        const [voice] = this._voices.splice(i, 1);
                        voice.strike(data.velocity);
                        this._voices.push(voice);
                        return;
                    }

                    const voice = new Voice(data.note);
                    voice.setParams(this._params);
                    voice.strike(data.velocity);
                    this._voices.push(voice);
                    while (this._voices.length > this._params.voices) {
                        this._voices.shift();
                    }

                    return;
            }
        };
    }
    process(_, outputs) {
        const out = outputs[0][0];
        for (let i = 0; i < out.length; ++i) {
            out[i] = this._voices.reduce(
                (sum, voice) => sum + voice.process(),
                0
            );
        }
        return true;
    }
}

registerProcessor('main', Processor);
