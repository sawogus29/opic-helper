import { openDB, saveData, loadData } from './db.js';

document.addEventListener('DOMContentLoaded', () => {
    const questionText = document.getElementById('question-text');
    const recordBtn = document.getElementById('record-btn');
    const analyzeBtn = document.getElementById('analyze-btn');
    const audioPlayback = document.getElementById('audio-playback');
    const resultsContainer = document.getElementById('results-container');
    const timerDisplay = document.getElementById('timer-display');

    let mediaRecorder;
    let audioChunks = [];
    let currentQuestionId = -1;
    let isRecording = false;
    let timerInterval;
    let seconds = 0;
    let audioContext, analyser, dataArray, source, animationFrameId;
    let questions = [];
    let currentAudioBlob = null;
    let currentResults = null;

    async function initializeApp() {
        try {
            await openDB(); // Open the database initially
            const response = await fetch('questions.json');
            const data = await response.json();
            questions = data.map(item => ({
                id: item.ID,
                question: atob(item.Question)
            }));
            
            const urlParams = new URLSearchParams(window.location.search);
            const questionId = urlParams.get('id');

            if (questionId === null) {
                questionText.textContent = "No question selected. Please go to the question list.";
                recordBtn.disabled = true;
                return;
            }

            currentQuestionId = questionId;
            const question = questions.find(q => q.id === currentQuestionId)?.question;

            if (!question) {
                questionText.textContent = "Question not found.";
                recordBtn.disabled = true;
                return;
            }
            questionText.textContent = question;

            loadPracticeData();
        } catch (error) {
            console.error('Failed to load questions:', error);
            questionText.textContent = 'Failed to load questions.';
        }
    }

    async function loadPracticeData() {
        const data = await loadData(currentQuestionId);
        if (data) {
            if (data.audioBlob) {
                currentAudioBlob = data.audioBlob;
                const audioUrl = URL.createObjectURL(data.audioBlob);
                audioPlayback.src = audioUrl;
                analyzeBtn.disabled = false;
            }
            if (data.results) {
                currentResults = data.results;
                displayResults(currentResults);
            }
        }
    }

    async function savePracticeData() {
        const data = {
            id: currentQuestionId,
            audioBlob: currentAudioBlob,
            results: currentResults,
        };
        await saveData(data);
    }

    recordBtn.addEventListener('click', () => {
        if (isRecording) {
            stopRecording();
        } else {
            startRecording();
        }
    });

    analyzeBtn.addEventListener('click', () => {
        if (currentAudioBlob) {
            analyzeSpeech(currentAudioBlob);
        } else {
            alert("No audio available to analyze. Please record an answer first.");
        }
    });

    async function startRecording() {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            alert('Your browser does not support audio recording.');
            return;
        }

        resultsContainer.innerHTML = '';
        currentAudioBlob = null;
        analyzeBtn.disabled = true;

        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        
        audioContext = new AudioContext();
        analyser = audioContext.createAnalyser();
        source = audioContext.createMediaStreamSource(stream);
        source.connect(analyser);
        visualize();

        mediaRecorder = new MediaRecorder(stream);

        mediaRecorder.ondataavailable = (event) => {
            audioChunks.push(event.data);
        };

        mediaRecorder.onstop = () => {
            const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
            currentAudioBlob = audioBlob;
            const audioUrl = URL.createObjectURL(audioBlob);
            audioPlayback.src = audioUrl;
            analyzeBtn.disabled = false;
            analyzeSpeech(audioBlob);
            audioChunks = [];
        };

        audioChunks = [];
        mediaRecorder.start();
        isRecording = true;
        recordBtn.classList.add('recording');
        startTimer();
    }

    function stopRecording() {
        mediaRecorder.stop();
        isRecording = false;
        recordBtn.classList.remove('recording');
        recordBtn.style.boxShadow = 'none'; // Reset the shadow
        stopTimer();
        cancelAnimationFrame(animationFrameId);
    }

    function startTimer() {
        seconds = 0;
        timerDisplay.textContent = '00:00';
        timerInterval = setInterval(() => {
            seconds++;
            const mins = Math.floor(seconds / 60).toString().padStart(2, '0');
            const secs = (seconds % 60).toString().padStart(2, '0');
            timerDisplay.textContent = `${mins}:${secs}`;
        }, 1000);
    }

    function stopTimer() {
        clearInterval(timerInterval);
    }

    function visualize() {
        analyser.fftSize = 32;
        const bufferLength = analyser.frequencyBinCount;
        dataArray = new Uint8Array(bufferLength);

        const draw = () => {
            animationFrameId = requestAnimationFrame(draw);
            analyser.getByteTimeDomainData(dataArray);
            
            let sum = 0;
            for(let i = 0; i < bufferLength; i++) {
                sum += Math.abs(dataArray[i] - 128);
            }
            let average = sum / bufferLength;
            
            const pulse = 4 + (average * 2.0); // Add a base size for better responsiveness
            recordBtn.style.boxShadow = `0 0 0 ${pulse}px rgba(220, 53, 69, 0.5)`;
        };
        draw();
    }

    async function analyzeSpeech(audioBlob) {
        const apiKey = localStorage.getItem('gemini_api_key');
        if (!apiKey) {
            alert('Please set your Gemini API key using the query parameter (e.g., ?GEMINI_API_KEY=YOUR_KEY) or ensure it\'s stored in localStorage.');
            return;
        }

        resultsContainer.innerHTML = '<p>Analyzing...</p>';
        analyzeBtn.disabled = true;

        try {
            const uploadUrlResponse = await fetch('https://generativelanguage.googleapis.com/upload/v1beta/files', {
                method: 'POST',
                headers: {
                    'x-goog-api-key': apiKey,
                    'X-Goog-Upload-Protocol': 'resumable',
                    'X-Goog-Upload-Command': 'start',
                    'X-Goog-Upload-Header-Content-Length': audioBlob.size,
                    'X-Goog-Upload-Header-Content-Type': audioBlob.type,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    'file': {
                        'display_name': `user-audio-q-${currentQuestionId}.webm`
                    }
                })
            });

            if (!uploadUrlResponse.ok) {
                throw new Error(`Failed to start upload: ${await uploadUrlResponse.text()}`);
            }

            const uploadUrl = uploadUrlResponse.headers.get('X-Goog-Upload-Url');
            const uploadResponse = await fetch(uploadUrl, {
                method: 'POST',
                headers: {
                    'X-Goog-Upload-Command': 'upload, finalize',
                    'X-Goog-Upload-Offset': '0'
                },
                body: audioBlob
            });

            if (!uploadResponse.ok) {
                throw new Error(`Failed to upload file: ${await uploadResponse.text()}`);
            }

            const uploadedFile = await uploadResponse.json();
            const fileUri = uploadedFile.file.uri;

            const generateContentResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite-preview-06-17:generateContent`, {
                method: 'POST',
                headers: {
                    'x-goog-api-key': apiKey,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    "contents": [{
                        "parts": [
                            { "text": "Transcribe this audio and then provide a refined natural version of the transcription. Provide the output as a JSON object with three keys: 'transcription', 'refined_version', and 'matches'. For each sentence in 'refined_version', the 'matches' array should contain an object with two keys: 'refined_version' (the sentence from 'refined_version') and 'transcription' (the corresponding part of the 'transcription')." },
                            { "file_data": { "mime_type": audioBlob.type, "file_uri": fileUri } }
                        ]
                    }],
                    "generationConfig": {
                        "response_mime_type": "application/json"
                    }
                })
            });

            if (!generateContentResponse.ok) {
                throw new Error(`Failed to generate content: ${await generateContentResponse.text()}`);
            }

            const data = await generateContentResponse.json();
            const resultJson = JSON.parse(data.candidates[0].content.parts[0].text);

            if (resultJson.matches && Array.isArray(resultJson.matches)) {
                resultJson.matches.forEach(match => {
                    match.isFavorite = false;
                });
            }

            currentResults = resultJson;
            displayResults(currentResults);
            savePracticeData();

        } catch (error) {
            console.error('Error with Gemini API:', error);
            resultsContainer.innerHTML = `<p>Error: ${error.message}</p>`;
        } finally {
            analyzeBtn.disabled = false;
        }
    }

    function displayResults(result) {
        let matchesHtml = '';
        if (result.matches && Array.isArray(result.matches)) {
            matchesHtml = '<h4>Matches:</h4>';
            result.matches.forEach((match, index) => {
                const isFavorited = match.isFavorite || false;
                matchesHtml += `
                    <div class="match-card">
                        <div class="match-header">
                            <button class="favorite-btn ${isFavorited ? 'favorited' : ''}" data-id="${index}">${isFavorited ? '★' : '☆'}</button>
                        </div>
                        <p class="match-card__transcription">${match.transcription}</p>
                        <p class="match-card__refined-version">${match.refined_version}</p>
                    </div>
                `;
            });
        }

        resultsContainer.innerHTML = `
            <h4>Transcription:</h4>
            <p>${result.transcription}</p>
            <h4>Refined Version:</h4>
            <p>${result.refined_version}</p>
            ${matchesHtml}
        `;

        document.querySelectorAll('.favorite-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const matchId = e.target.dataset.id;
                toggleFavorite(matchId, e.target);
            });
        });
    }

    async function toggleFavorite(matchId, button) {
        const match = currentResults.matches[parseInt(matchId)];
        if (match) {
            match.isFavorite = !match.isFavorite;
            
            button.classList.toggle('favorited', match.isFavorite);
            button.textContent = match.isFavorite ? '★' : '☆';

            await savePracticeData();
        }
    }

    initializeApp();
});