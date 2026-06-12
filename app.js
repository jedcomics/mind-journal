// ── Config ─────────────────────────────────────────────────
const CLIENT_ID = '416236438159-djp1u7f3el24m8fqejh329nld5mdsj68.apps.googleusercontent.com';
const SCOPES = 'https://www.googleapis.com/auth/drive.appdata';
const FILENAME = 'mind-journal-entries.json';

// ── State ───────────────────────────────────────────────────
let accessToken = null;
let driveFileId = null;
let allEntries = [];

// ── Init ────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    // Date line
    document.getElementById('dateLine').textContent = new Date().toLocaleDateString('en-US', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });

    // Seed Gemini key from URL param
    const params = new URLSearchParams(window.location.search);
    const urlKey = params.get('key');
    if (urlKey) {
        localStorage.setItem('gemini_api_key', urlKey);
        window.history.replaceState({}, '', window.location.pathname);
    }

    const saved = localStorage.getItem('gemini_api_key');
    if (saved) {
        document.getElementById('apiKey').value = saved;
        setKeyStatus(true);
    } else {
        setKeyStatus(false);
    }

    // Restore Drive token from session if present
    const sessionToken = sessionStorage.getItem('drive_token');
    if (sessionToken) {
        accessToken = sessionToken;
        onDriveConnected();
    }
});

// ── Settings drawer ─────────────────────────────────────────
document.getElementById('settingsBtn').addEventListener('click', () => {
    document.getElementById('settingsDrawer').classList.toggle('open');
});

// ── Gemini key ──────────────────────────────────────────────
document.getElementById('saveKeyBtn').addEventListener('click', () => {
    const val = document.getElementById('apiKey').value.trim();
    if (!val) { setKeyStatus(false); return; }
    localStorage.setItem('gemini_api_key', val);
    setKeyStatus(true);
    document.getElementById('settingsDrawer').classList.remove('open');
});

function setKeyStatus(isSet) {
    const el = document.getElementById('keyStatus');
    el.textContent = isSet ? '✓ Key saved in this browser.' : 'No key saved.';
    el.className = 'status-line' + (isSet ? ' ok' : '');
}

// ── Character count ─────────────────────────────────────────
document.getElementById('journalInput').addEventListener('input', function () {
    document.getElementById('charCount').textContent = this.value.length + ' characters';
});

// ── Google Drive OAuth (GIS token client) ───────────────────
let tokenClient;

window.addEventListener('load', () => {
    // GIS may not be ready immediately; poll briefly
    const initGIS = setInterval(() => {
        if (typeof google === 'undefined' || !google.accounts) return;
        clearInterval(initGIS);

        tokenClient = google.accounts.oauth2.initTokenClient({
            client_id: CLIENT_ID,
            scope: SCOPES,
            callback: async (resp) => {
                if (resp.error) {
                    setDriveStatus(false, 'Sign-in failed: ' + resp.error);
                    return;
                }
                accessToken = resp.access_token;
                sessionStorage.setItem('drive_token', accessToken);
                onDriveConnected();
            }
        });
    }, 200);
});

document.getElementById('driveSignInBtn').addEventListener('click', () => {
    if (!tokenClient) { alert('Google Identity Services not loaded yet. Try again in a moment.'); return; }
    tokenClient.requestAccessToken({ prompt: 'consent' });
});

document.getElementById('driveSignOutBtn').addEventListener('click', () => {
    if (accessToken && typeof google !== 'undefined') {
        google.accounts.oauth2.revoke(accessToken);
    }
    accessToken = null;
    driveFileId = null;
    allEntries = [];
    sessionStorage.removeItem('drive_token');
    setDriveStatus(false, 'Signed out.');
    document.getElementById('driveSignInBtn').style.display = '';
    document.getElementById('driveSignOutBtn').style.display = 'none';
    document.getElementById('historyBtn').style.display = 'none';
    document.getElementById('entriesPanel').style.display = 'none';
});

async function onDriveConnected() {
    setDriveStatus(true, 'Connected');
    document.getElementById('driveSignInBtn').style.display = 'none';
    document.getElementById('driveSignOutBtn').style.display = '';
    document.getElementById('historyBtn').style.display = '';
    document.getElementById('settingsDrawer').classList.remove('open');
    await loadEntriesFromDrive();
}

function setDriveStatus(connected, text) {
    const el = document.getElementById('driveStatus');
    el.className = 'driveStatus' + (connected ? ' connected' : '');
    document.getElementById('driveStatusText').textContent = text;
    const drawer = document.getElementById('driveDrawerStatus');
    drawer.textContent = connected ? '✓ ' + text + '. Entries will auto-save after each reflection.' : text;
    drawer.className = 'status-line' + (connected ? ' ok' : ' err');
}

// ── Drive: load entries ──────────────────────────────────────
async function loadEntriesFromDrive() {
    try {
        // Find existing file in appDataFolder
        const searchRes = await fetch(
            `https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=name='${FILENAME}'&fields=files(id,name)`,
            { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        const searchData = await searchRes.json();

        if (searchData.files && searchData.files.length > 0) {
            driveFileId = searchData.files[0].id;
            const contentRes = await fetch(
                `https://www.googleapis.com/drive/v3/files/${driveFileId}?alt=media`,
                { headers: { Authorization: `Bearer ${accessToken}` } }
            );
            allEntries = await contentRes.json();
        } else {
            allEntries = [];
        }
        renderEntriesList();
    } catch (e) {
        console.error('Drive load error:', e);
    }
}

// ── Drive: save entries ──────────────────────────────────────
async function saveEntriesToDrive() {
    const body = JSON.stringify(allEntries);
    const blob = new Blob([body], { type: 'application/json' });

    if (driveFileId) {
        // Update existing file
        await fetch(`https://www.googleapis.com/upload/drive/v3/files/${driveFileId}?uploadType=media`, {
            method: 'PATCH',
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            },
            body: blob
        });
    } else {
        // Create new file in appDataFolder
        const meta = { name: FILENAME, parents: ['appDataFolder'] };
        const form = new FormData();
        form.append('metadata', new Blob([JSON.stringify(meta)], { type: 'application/json' }));
        form.append('file', blob);

        const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', {
            method: 'POST',
            headers: { Authorization: `Bearer ${accessToken}` },
            body: form
        });
        const data = await res.json();
        driveFileId = data.id;
    }
}

// ── History panel ────────────────────────────────────────────
document.getElementById('historyBtn').addEventListener('click', () => {
    const panel = document.getElementById('entriesPanel');
    const isVisible = panel.style.display === 'block';
    panel.style.display = isVisible ? 'none' : 'block';
    if (!isVisible) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

document.getElementById('refreshEntriesBtn').addEventListener('click', async () => {
    await loadEntriesFromDrive();
});

function renderEntriesList() {
    const panel = document.getElementById('entriesPanel');
    const list = document.getElementById('entriesList');
    list.innerHTML = '';

    if (allEntries.length === 0) {
        list.innerHTML = '<p style="font-size:13px;color:var(--ink-light);font-style:italic">No entries yet.</p>';
        return;
    }

    // Newest first
    [...allEntries].reverse().forEach((entry, i) => {
        const card = document.createElement('div');
        card.className = 'entry-card';
        card.innerHTML = `
            <div class="entry-card-date">${entry.date}</div>
            <div class="entry-card-distortion">${entry.analysis.distortion || 'No distortion identified'}</div>
            <div class="entry-card-preview">${entry.text}</div>
        `;
        card.addEventListener('click', () => openEntryModal(entry));
        list.appendChild(card);
    });

    panel.style.display = 'block';
}

function openEntryModal(entry) {
    document.getElementById('modalDate').textContent = entry.date;
    document.getElementById('modalEntryText').textContent = entry.text;
    document.getElementById('modalDistortion').textContent = entry.analysis.distortion || 'None identified';
    document.getElementById('modalCbt').textContent = entry.analysis.cbt;
    document.getElementById('modalStoic').textContent = entry.analysis.stoicism;
    document.getElementById('modalMusashi').textContent = entry.analysis.musashi;
    document.getElementById('modalBuddhism').textContent = entry.analysis.buddhism;
    document.getElementById('modalTaoism').textContent = entry.analysis.taoism;
    document.getElementById('entryModal').classList.add('open');
}

document.getElementById('modalClose').addEventListener('click', () => {
    document.getElementById('entryModal').classList.remove('open');
});
document.getElementById('entryModal').addEventListener('click', (e) => {
    if (e.target === document.getElementById('entryModal')) {
        document.getElementById('entryModal').classList.remove('open');
    }
});

// ── Analysis ─────────────────────────────────────────────────
async function processEntry() {
    const apiKey = localStorage.getItem('gemini_api_key');
    const text = document.getElementById('journalInput').value.trim();

    if (!apiKey) {
        document.getElementById('noKeyNotice').style.display = 'block';
        document.getElementById('settingsDrawer').classList.add('open');
        return;
    }
    document.getElementById('noKeyNotice').style.display = 'none';
    if (!text) { document.getElementById('journalInput').focus(); return; }

    const btn = document.getElementById('analyzeBtn');
    const loading = document.getElementById('loading');
    const results = document.getElementById('results');
    const saveIndicator = document.getElementById('saveIndicator');

    btn.disabled = true;
    loading.style.display = 'block';
    results.style.display = 'none';
    saveIndicator.style.display = 'none';

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

    const MODELS = ['gemini-2.5-flash', 'gemini-2.0-flash'];
    const payload = {
        contents: [{ parts: [{ text }] }],
        systemInstruction: { parts: [{ text: systemInstruction }] },
        generationConfig: { responseMimeType: 'application/json', temperature: 0.3 }
    };

    const sleep = ms => new Promise(r => setTimeout(r, ms));

    async function callGemini(model) {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!response.ok) {
            const errBody = await response.json().catch(() => ({}));
            const err = new Error(errBody?.error?.message || `HTTP ${response.status}`);
            err.status = response.status;
            throw err;
        }
        return response.json();
    }

    try {
        let data = null;
        for (let i = 0; i < MODELS.length; i++) {
            try {
                data = await callGemini(MODELS[i]);
                break;
            } catch (err) {
                const isOverload = err.status === 503 || err.status === 429;
                if (isOverload && i < MODELS.length - 1) { await sleep(2000); continue; }
                throw err;
            }
        }

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

        // Save to Drive if connected
        if (accessToken) {
            const entry = {
                id: Date.now(),
                date: new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
                text,
                analysis: parsed
            };
            allEntries.push(entry);
            await saveEntriesToDrive();
            saveIndicator.style.display = 'block';
            renderEntriesList();
        }

    } catch (error) {
        console.error(error);
        const isOverload = error.status === 503 || error.status === 429;
        alert(isOverload
            ? 'Gemini is overloaded right now. Wait a minute and try again.'
            : 'Analysis failed: ' + error.message);
    } finally {
        btn.disabled = false;
        loading.style.display = 'none';
    }
}
