// ── Date line ──────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    const d = new Date();
    document.getElementById('dateLine').textContent = d.toLocaleDateString('en-US', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });

    // Seed key from URL param ?key=... (one-time setup), then strip it from the URL
    const params = new URLSearchParams(window.location.search);
    const urlKey = params.get('key');
    if (urlKey) {
        localStorage.setItem('gemini_api_key', urlKey);
        window.history.replaceState({}, '', window.location.pathname);
    }

    // Populate field and update status
    const saved = localStorage.getItem('gemini_api_key');
    if (saved) {
        document.getElementById('apiKey').value = saved;
        setKeyStatus(true);
    } else {
        setKeyStatus(false);
    }
});

// ── Settings drawer toggle ──────────────────────────────────
document.getElementById('settingsBtn').addEventListener('click', () => {
    document.getElementById('settingsDrawer').classList.toggle('open');
});

// ── Save key button ─────────────────────────────────────────
document.getElementById('saveKeyBtn').addEventListener('click', () => {
    const val = document.getElementById('apiKey').value.trim();
    if (!val) {
        setKeyStatus(false);
        return;
    }
    localStorage.setItem('gemini_api_key', val);
    setKeyStatus(true);
    document.getElementById('settingsDrawer').classList.remove('open');
});

function setKeyStatus(isSet) {
    const el = document.getElementById('keyStatus');
    if (isSet) {
        el.textContent = '✓ Key saved in this browser.';
        el.className = 'key-status set';
    } else {
        el.textContent = 'No key saved.';
        el.className = 'key-status';
    }
}

// ── Character count ─────────────────────────────────────────
document.getElementById('journalInput').addEventListener('input', function () {
    document.getElementById('charCount').textContent = this.value.length + ' characters';
});

// ── Analysis ────────────────────────────────────────────────
async function processEntry() {
    const apiKey = localStorage.getItem('gemini_api_key');
    const text = document.getElementById('journalInput').value.trim();

    if (!apiKey) {
        document.getElementById('noKeyNotice').style.display = 'block';
        document.getElementById('settingsDrawer').classList.add('open');
        return;
    }
    document.getElementById('noKeyNotice').style.display = 'none';

    if (!text) {
        document.getElementById('journalInput').focus();
        return;
    }

    const btn = document.getElementById('analyzeBtn');
    const loading = document.getElementById('loading');
    const results = document.getElementById('results');

    btn.disabled = true;
    loading.style.display = 'block';
    results.style.display = 'none';
    results.scrollIntoView = undefined;

    const systemInstruction = `You are a clinical CBT backend engine integrated with Stoicism, Miyamoto Musashi's warrior ethos (Dokkodo), Buddhism, and Taoism. Analyze the user's raw journal entry and return a structured JSON response.

Apply these five lenses:
1. CBT: Identify explicit cognitive distortions and provide a direct rational reframe.
2. Stoicism: Apply the Dichotomy of Control. Isolate what is internal and within control versus what is external.
3. Musashi: Apply the spirit of the Dokkodo. Focus on absolute detachment, acceptance of reality, and total self-reliance.
4. Buddhism: Highlight impermanence (Anicca) or how ego-attachment (Anatta) generates this friction.
5. Taoism: Introduce non-striving (Wu Wei). Explain how to yield or align with the natural flow.

Respond exclusively in this exact JSON schema. No preamble, no markdown fences:
{
  "distortion": "string",
  "cbt": "string",
  "stoicism": "string",
  "musashi": "string",
  "buddhism": "string",
  "taoism": "string"
}`;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

    const payload = {
        contents: [{ parts: [{ text }] }],
        systemInstruction: { parts: [{ text: systemInstruction }] },
        generationConfig: {
            responseMimeType: 'application/json',
            temperature: 0.3
        }
    };

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errBody = await response.json().catch(() => ({}));
            const msg = errBody?.error?.message || `HTTP ${response.status}`;
            throw new Error(msg);
        }

        const data = await response.json();
        const rawJsonText = data.candidates[0].content.parts[0].text;
        const parsed = JSON.parse(rawJsonText);

        document.getElementById('distortionOut').textContent = parsed.distortion || 'None identified';
        document.getElementById('cbtOut').textContent = parsed.cbt;
        document.getElementById('stoicOut').textContent = parsed.stoicism;
        document.getElementById('musashiOut').textContent = parsed.musashi;
        document.getElementById('buddhistOut').textContent = parsed.buddhism;
        document.getElementById('taoistOut').textContent = parsed.taoism;

        results.style.display = 'block';
        results.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (error) {
        console.error(error);
        alert('Analysis failed: ' + error.message + '\n\nCheck your API key and network connection.');
    } finally {
        btn.disabled = false;
        loading.style.display = 'none';
    }
}
