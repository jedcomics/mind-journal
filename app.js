// ── Config ─────────────────────────────────────────────────
const CLIENT_ID = '416236438159-djp1u7f3el24m8fqejh329nld5mdsj68.apps.googleusercontent.com';
const SCOPES = 'https://www.googleapis.com/auth/drive.appdata';
const FILENAME = 'mind-journal-entries.json';

// ── State ───────────────────────────────────────────────────
let accessToken = null;
let driveFileId = null;
let allEntries = [];
let conversationHistory = [];  // resets on each new Reflect

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

// ── Journal Memory ───────────────────────────────────────────
const savedMemory = localStorage.getItem('journal_memory');
if (savedMemory) {
    document.getElementById('journalMemory').value = savedMemory;
    setMemoryStatus(true);
}

document.getElementById('saveMemoryBtn').addEventListener('click', () => {
    const val = document.getElementById('journalMemory').value.trim();
    if (!val) {
        localStorage.removeItem('journal_memory');
        setMemoryStatus(false);
        return;
    }
    localStorage.setItem('journal_memory', val);
    setMemoryStatus(true);
    document.getElementById('settingsDrawer').classList.remove('open');
});

function setMemoryStatus(isSet) {
    const el = document.getElementById('memoryStatus');
    el.textContent = isSet ? '✓ Memory saved — AI will use this in every reflection.' : 'No memory saved.';
    el.className = 'status-line' + (isSet ? ' ok' : '');
}

// ── Character count (tracks all three ABC fields) ───────────
['inputA', 'inputB', 'inputC'].forEach(id => {
    document.getElementById(id).addEventListener('input', () => {
        const total = ['inputA', 'inputB', 'inputC']
            .reduce((sum, fid) => sum + (document.getElementById(fid).value.length), 0);
        document.getElementById('charCount').textContent = total + ' characters';
    });
});

// ── Reminders toggle ─────────────────────────────────────────
document.getElementById('remindersToggle').addEventListener('click', () => {
    document.getElementById('remindersToggle').classList.toggle('open');
    document.getElementById('remindersPanel').classList.toggle('open');
});

// ── Reflect button ───────────────────────────────────────────
document.getElementById('analyzeBtn').addEventListener('click', processEntry);

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
            <div class="entry-card-preview">${entry.textA || entry.text}</div>
        `;
        card.addEventListener('click', () => openEntryModal(entry));
        list.appendChild(card);
    });

    panel.style.display = 'block';
}

function openEntryModal(entry) {
    document.getElementById('modalDate').textContent = entry.date;
    // Support both old (entry.text) and new (entry.textA/B/C) formats
    const abcText = entry.textA
        ? `A: ${entry.textA}\n\nB: ${entry.textB || '—'}\n\nC: ${entry.textC || '—'}`
        : entry.text;
    document.getElementById('modalEntryText').textContent = abcText;
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
    const textA = document.getElementById('inputA').value.trim();
    const textB = document.getElementById('inputB').value.trim();
    const textC = document.getElementById('inputC').value.trim();

    if (!apiKey) {
        document.getElementById('noKeyNotice').style.display = 'block';
        document.getElementById('settingsDrawer').classList.add('open');
        return;
    }
    document.getElementById('noKeyNotice').style.display = 'none';
    if (!textA && !textB && !textC) { document.getElementById('inputA').focus(); return; }

    const text = `A (Activating Event): ${textA || '(not provided)'}\nB (Belief): ${textB || '(not provided)'}\nC (Consequence): ${textC || '(not provided)'}`;

    const btn = document.getElementById('analyzeBtn');
    const loadingEl = document.getElementById('loading');
    const resultsEl = document.getElementById('results');
    const saveIndicator = document.getElementById('saveIndicator');

    btn.disabled = true;
    loadingEl.style.display = 'block';
    resultsEl.style.display = 'none';
    saveIndicator.style.display = 'none';

    // ── Build context blocks ─────────────────────────────────
    const userMemory = localStorage.getItem('journal_memory');
    const memoryBlock = userMemory
        ? `\n\nUSER CONTEXT (use this to personalize responses — weave it in naturally, do not repeat it verbatim):\n${userMemory}`
        : '';

    // Last 5 entries as pattern history, most recent first
    const historyBlock = (() => {
        if (!allEntries || allEntries.length === 0) return '';
        const recent = [...allEntries].reverse().slice(0, 5);
        const lines = recent.map((e, i) => {
            const distortion = e.analysis?.distortion || 'unknown';
            const a = e.textA || e.text || '';
            const b = e.textB || '';
            const c = e.textC || '';
            return `Entry ${i + 1} (${e.date}):\n  Distortion: ${distortion}\n  A: ${a}\n  B: ${b}\n  C: ${c}`;
        }).join('\n\n');
        return `\n\nUSER'S RECENT JOURNAL HISTORY (last ${recent.length} entries — use this to identify recurring patterns, track growth, or note if a distortion is repeating):\n${lines}`;
    })();

    const systemInstruction = `You are a clinical CBT backend engine integrated with Stoicism, Miyamoto Musashi's warrior ethos (Dokkodo), Buddhism, and Taoism. Analyze the user's ABC journal entry and return a structured JSON response.

The entry is structured as:
A (Activating Event): the objective situation
B (Belief): the automatic thought or interpretation
C (Consequence): the emotional or behavioral reaction

Apply these five lenses:
1. CBT: Identify the explicit cognitive distortion present in the B belief and provide a direct rational reframe. If the same distortion has appeared in past entries, name the pattern explicitly.
2. Stoicism: Apply the Dichotomy of Control. Isolate what is internal and within control versus what is external.
3. Musashi: Apply the spirit of the Dokkodo. Focus on absolute detachment, acceptance of reality, and total self-reliance.
4. Buddhism: Highlight impermanence (Anicca) or how ego-attachment (Anatta) generates this friction.
5. Taoism: Introduce non-striving (Wu Wei). Explain how to yield or align with the natural flow.

When user context or journal history is provided, use it to make responses specific and personally relevant — not generic. If history shows growth or a repeated pattern, acknowledge it briefly and honestly.${memoryBlock}${historyBlock}

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

    const callGemini = async (model) => {
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
    };

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

        resultsEl.style.display = 'block';
        resultsEl.scrollIntoView({ behavior: 'smooth', block: 'start' });

        // Reset and seed conversation history with this entry + analysis
        conversationHistory = [
            {
                role: 'user',
                parts: [{ text: `My journal entry:\n${text}` }]
            },
            {
                role: 'model',
                parts: [{ text: `Here is my analysis:\n\nDistortion: ${parsed.distortion}\n\nCBT: ${parsed.cbt}\n\nStoicism: ${parsed.stoicism}\n\nMusashi: ${parsed.musashi}\n\nBuddhism: ${parsed.buddhism}\n\nTaoism: ${parsed.taoism}` }]
            }
        ];

        // Show chat thread, clear previous messages
        const chatThread = document.getElementById('chatThread');
        const chatMessages = document.getElementById('chatMessages');
        chatMessages.innerHTML = '';
        chatThread.style.display = 'block';

        // Save to Drive if connected
        if (accessToken) {
            const entry = {
                id: Date.now(),
                date: new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
                text,
                textA, textB, textC,
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
        loadingEl.style.display = 'none';
    }
}

// ── Follow-up chat ───────────────────────────────────────────
document.getElementById('chatSendBtn').addEventListener('click', sendFollowUp);
document.getElementById('chatInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendFollowUp(); }
});

async function sendFollowUp() {
    const apiKey = localStorage.getItem('gemini_api_key');
    const input = document.getElementById('chatInput');
    const msg = input.value.trim();
    if (!msg || !apiKey) return;

    const userMemory = localStorage.getItem('journal_memory');
    const memoryNote = userMemory
        ? `\n\nUser context (for personalizing responses): ${userMemory}`
        : '';

    // Append user bubble
    appendChatBubble('user', msg);
    input.value = '';
    input.disabled = true;

    const sendBtn = document.getElementById('chatSendBtn');
    sendBtn.disabled = true;
    sendBtn.textContent = '...';

    // Add user message to history
    conversationHistory.push({ role: 'user', parts: [{ text: msg }] });

    const systemInstruction = `You are a compassionate CBT-informed advisor who also draws on Stoicism, Musashi's Dokkodo, Buddhism, and Taoism. The user has just received a structured journal analysis and wants to continue the conversation — to clarify, ask questions, or go deeper. Respond conversationally and warmly. Be direct and specific. No bullet lists unless the user asks. No JSON.${memoryNote}`;

    const MODELS = ['gemini-2.5-flash', 'gemini-2.0-flash'];
    const sleep = ms => new Promise(r => setTimeout(r, ms));

    try {
        let responseText = null;
        for (let i = 0; i < MODELS.length; i++) {
            try {
                const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODELS[i]}:generateContent?key=${apiKey}`;
                const res = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: conversationHistory,
                        systemInstruction: { parts: [{ text: systemInstruction }] },
                        generationConfig: { temperature: 0.6 }
                    })
                });
                if (!res.ok) {
                    const errBody = await res.json().catch(() => ({}));
                    const err = new Error(errBody?.error?.message || `HTTP ${res.status}`);
                    err.status = res.status;
                    throw err;
                }
                const data = await res.json();
                responseText = data.candidates[0].content.parts[0].text;
                break;
            } catch (err) {
                const isOverload = err.status === 503 || err.status === 429;
                if (isOverload && i < MODELS.length - 1) { await sleep(2000); continue; }
                throw err;
            }
        }

        // Add AI response to history and render
        conversationHistory.push({ role: 'model', parts: [{ text: responseText }] });
        appendChatBubble('ai', responseText);

    } catch (err) {
        appendChatBubble('ai', 'Something went wrong: ' + err.message);
    } finally {
        input.disabled = false;
        sendBtn.disabled = false;
        sendBtn.textContent = 'Send';
        input.focus();
    }
}

function appendChatBubble(role, text) {
    const container = document.getElementById('chatMessages');
    const bubble = document.createElement('div');
    bubble.className = 'chat-bubble chat-' + role;
    bubble.textContent = text;
    container.appendChild(bubble);
    bubble.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
