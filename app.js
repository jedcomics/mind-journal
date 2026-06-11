// Automatically load the key from browser storage when the page opens
document.addEventListener('DOMContentLoaded', () => {
    const savedKey = localStorage.getItem('gemini_api_key');
    if (savedKey) {
        document.getElementById('apiKey').value = savedKey;
    }
});

async function processEntry() {
    const apiKey = document.getElementById('apiKey').value;
    const text = document.getElementById('journalInput').value;
    
    if (!apiKey || !text) {
        alert('Provide both your API key and a journal entry.');
        return;
    }

    // Save the key locally in the browser so it persists next time
    localStorage.setItem('gemini_api_key', apiKey);

    const btn = document.getElementById('analyzeBtn');
    const loading = document.getElementById('loading');
    const results = document.getElementById('results');

    btn.disabled = true;
    loading.style.display = 'block';
    results.style.display = 'none';

    const systemInstruction = `You are a clinical CBT backend engine integrated with Stoicism, Miyamoto Musashi's warrior ethos (Dokkodo), Buddhism, and Taoism. Analyze the user's raw journal entry and return a structured JSON response.

    Apply these five lenses:
    1. CBT: Identify explicit cognitive distortions and provide a direct rational reframe.
    2. Stoicism: Apply the Dichotomy of Control. Isolate what is internal and within control versus what is external. 
    3. Musashi: Apply the spirit of the Dokkodo. Focus on absolute detachment, acceptance of reality, and total self-reliance.
    4. Buddhism: Highlight impermanence (Anicca) or how ego-attachment (Anatta) generates this friction.
    5. Taoism: Introduce non-striving (Wu Wei). Explain how to yield or align with the natural flow.

    Respond exclusively in this exact JSON schema format:
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
        contents: [{ parts: [{ text: text }] }],
        systemInstruction: { parts: [{ text: systemInstruction }] },
        generationConfig: {
            responseMimeType: "application/json",
            temperature: 0.3
        }
    };

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) throw new Error(`API HTTP error: ${response.status}`);

        const data = await response.json();
        const rawJsonText = data.candidates[0].content.parts[0].text;
        const parsed = JSON.parse(rawJsonText);

        document.getElementById('distortionOut').innerText = parsed.distortion || 'None identified';
        document.getElementById('cbtOut').innerText = parsed.cbt;
        document.getElementById('stoicOut').innerText = parsed.stoicism;
        document.getElementById('musashiOut').innerText = parsed.musashi;
        document.getElementById('buddhistOut').innerText = parsed.buddhism;
        document.getElementById('taoistOut').innerText = parsed.taoism;
        
        results.style.display = 'block';
    } catch (error) {
        console.error(error);
        alert('Analysis failed. Verify your network, console logs, and API key.');
    } finally {
        btn.disabled = false;
        loading.style.display = 'none';
    }
}
