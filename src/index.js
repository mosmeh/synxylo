import * as Tone from 'tone';
import './style.css';
import worklet from '-!url-loader?limit=false!./worklet';

class Synth {
    constructor() {
        this._reverb = new Tone.Reverb().set({
            wet: 0.3,
            decay: 0.5,
            preDelay: 0.01,
        });
        this._gain = new Tone.Gain(1);
        const limiter = new Tone.Limiter(-20);

        this._reverb.chain(this._gain, limiter, Tone.Destination);
    }

    async setup() {
        const context = Tone.getContext();

        await context.addAudioWorkletModule(worklet, 'main');
        const workletNode = context.createAudioWorkletNode('main', {
            numberOfInputs: 0,
            numberOfOutputs: 1,
            outputChannelCount: [1],
        });
        this._port = workletNode.port;

        Tone.connect(workletNode, this._reverb);
    }

    setVolume(volume) {
        this._gain.gain.value = volume;
    }

    setParams(params) {
        this._port.postMessage({
            type: 'setParams',
            params,
        });
    }

    noteOn(note, velocity) {
        this._port.postMessage({
            type: 'noteOn',
            note,
            velocity,
        });
    }
}

const keys = {};
document.querySelectorAll('.key').forEach((key) => {
    keys[+key.dataset.note] = key;
});

const timers = {};
function highlightKey(note) {
    note = +note;
    if (note in keys) {
        const key = keys[note];
        key.classList.add('pressed');

        clearTimeout(timers[note]);
        timers[note] = setTimeout(() => {
            key.classList.remove('pressed');
        }, 100);
    }
}

function unhighlightKey(note) {
    note = +note;
    if (note in keys) {
        const key = keys[note];
        key.classList.remove('pressed');
        clearTimeout(timers[note]);
    }
}

async function setup() {
    await Tone.start();

    const synth = new Synth();
    await synth.setup();

    const volume = document.getElementById('volume');
    synth.setVolume(volume.value);
    volume.addEventListener('input', (e) => {
        synth.setVolume(e.target.value);
    });

    const params = {};
    ['voices', 'stiffness', 'decay', 'material', 'position'].forEach((id) => {
        const input = document.getElementById(id);
        params[id] = input.value;
        input.addEventListener('input', (e) => {
            params[id] = e.target.value;
            synth.setParams(params);
        });
    });
    synth.setParams(params);

    function noteOnMidi(note, velocity) {
        synth.noteOn(+note, +velocity);
        highlightKey(+note - 12 * +octave.value);
    }
    function noteOffMidi(note) {
        unhighlightKey(+note - 12 * +octave.value);
    }

    const octave = document.getElementById('octave');
    function noteOnScreen(note) {
        synth.noteOn(+note + 12 * +octave.value, 100);
        highlightKey(+note);
    }
    function noteOffScreen(note) {
        unhighlightKey(+note);
    }

    for (const [note, key] of Object.entries(keys)) {
        function downHandler(e) {
            e.preventDefault();
            noteOnScreen(note);
        }
        key.addEventListener('mousedown', downHandler);
        key.addEventListener('touchstart', downHandler);

        function upHandler(e) {
            e.preventDefault();
            noteOffScreen(note);
        }
        key.addEventListener('mouseup', upHandler);
        key.addEventListener('mouseleave', upHandler);
        key.addEventListener('touchend', upHandler);

        key.addEventListener('mouseenter', (e) => {
            if (e.buttons !== 0) {
                e.preventDefault();
                noteOnScreen(note);
            }
        });
    }

    // prettier-ignore
    const KEYS = [
        'KeyA', 'KeyW', 'KeyS', 'KeyE', 'KeyD', 'KeyF', 'KeyT', 'KeyG',
        'KeyY', 'KeyH', 'KeyU', 'KeyJ', 'KeyK', 'KeyO', 'KeyL'
    ];
    document.addEventListener('keydown', (e) => {
        if (e.repeat || e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) {
            return;
        }

        switch (e.code) {
            case 'KeyZ':
                octave.value = Math.max(+octave.value - 1, +octave.min);
                return;
            case 'KeyX':
                octave.value = Math.min(+octave.value + 1, +octave.max);
                return;
        }

        const i = KEYS.indexOf(e.code);
        if (i !== -1) {
            e.preventDefault();
            noteOnScreen(i + 60);
        }
    });
    document.addEventListener('keyup', (e) => {
        const i = KEYS.indexOf(e.code);
        if (i !== -1) {
            e.preventDefault();
            noteOffScreen(i + 60);
        }
    });

    function onMidiMessage(e) {
        const msg = e.data[0] & 0xf0;
        const note = e.data[1];
        const velocity = e.data[2];
        switch (msg & 0xf0) {
            case 0x90:
                if (velocity > 0) {
                    noteOnMidi(note, velocity);
                } else {
                    noteOffMidi(note);
                }
                break;
            case 0x80:
                noteOffMidi(note);
                break;
        }
    }

    if (typeof navigator.requestMIDIAccess === 'function') {
        navigator.requestMIDIAccess().then((access) => {
            let inputs;
            if (typeof access.inputs === 'function') {
                inputs = access.inputs();
            } else {
                inputs = access.inputs.values();
            }
            for (const i of inputs) {
                i.onmidimessage = onMidiMessage;
            }
        });
    }
}

setup();

function resume() {
    Tone.start();
}

document.addEventListener('mousedown', resume);
document.addEventListener('keydown', resume);
