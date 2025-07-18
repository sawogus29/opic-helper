import { loadData, getAllData } from './db.js';

document.addEventListener('DOMContentLoaded', async () => {
    // Handle auth_token from URL and localStorage
    const urlParams = new URLSearchParams(window.location.search);
    const authToken = urlParams.get('auth_token');
    let geminiApiKey = null;

    if (authToken) {
        try {
            const decoded = atob(decodeURIComponent(authToken));
            const [dateString, key] = decoded.split(':');
            const tokenDate = new Date(dateString);
            const today = new Date();

            // Set both dates to UTC midnight for accurate comparison
            tokenDate.setUTCHours(0, 0, 0, 0);
            today.setUTCHours(0, 0, 0, 0);

            // Check if the token date is today or in the future (allowing for slight clock differences)
            if (tokenDate.getTime() >= today.getTime()) {
                geminiApiKey = key;
                localStorage.setItem('gemini_api_key', geminiApiKey);
            } else {
                console.warn('Auth token expired or invalid date. Not storing API key.');
            }
        } catch (error) {
            console.error('Failed to decode or parse auth_token:', error);
        }
    }

    if (!geminiApiKey) {
        geminiApiKey = localStorage.getItem('gemini_api_key');
    }

    const questionListContainer = document.getElementById('question-list');
    const downloadAllResultsBtn = document.getElementById('download-all-results-btn');
    const includeAudioCheckbox = document.getElementById('include-audio-checkbox');
    const groupSelector = document.getElementById('group-selector');
    const progressBarText = document.getElementById('progress-bar-text');
    const progressBarFill = document.getElementById('progress-bar-fill');
    let questions = [];
    let groupedQuestions = {};

    async function updateProgressBar() {
        const totalQuestions = questions.length;
        let doneCount = 0;
        for (const question of questions) {
            if (await loadData(question.id)) {
                doneCount++;
            }
        }
        progressBarText.textContent = `${doneCount}/${totalQuestions}`;
        const progressPercentage = totalQuestions > 0 ? (doneCount / totalQuestions) * 100 : 0;
        progressBarFill.style.width = `${progressPercentage}%`;
    }

    async function loadQuestions() {
        try {
            const response = await fetch('questions.json');
            const data = await response.json();
            questions = data.map((item, index) => ({
                id: item.ID,
                question: atob(item.Question),
                originalIndex: index
            }));
            groupQuestions();
            populateGroupSelector();
            await displayGroup(Object.keys(groupedQuestions)[0]);
            await updateProgressBar();
        } catch (error) {
            console.error('Failed to load questions:', error);
            questionListContainer.textContent = 'Failed to load questions.';
        }
    }

    function groupQuestions() {
        groupedQuestions = questions.reduce((acc, questionData) => {
            const groupId = questionData.id.substring(0, 5);
            if (!acc[groupId]) {
                acc[groupId] = [];
            }
            acc[groupId].push(questionData);
            return acc;
        }, {});
    }

    function populateGroupSelector() {
        for (const groupId in groupedQuestions) {
            const option = document.createElement('option');
            option.value = groupId;
            option.textContent = groupId.replace('_', ' ');
            groupSelector.appendChild(option);
        }
    }

    async function displayGroup(groupId) {
        questionListContainer.innerHTML = '';
        let hasPracticeData = false;

        const groupContainer = document.createElement('div');
        groupContainer.classList.add('question-group');
        
        const groupTitle = document.createElement('h3');
        groupTitle.textContent = groupId.replace('_', ' ');
        groupContainer.appendChild(groupTitle);

        for (const questionData of groupedQuestions[groupId]) {
            const questionItem = document.createElement('div');
            questionItem.classList.add('question-item');

            const practiceData = await loadData(questionData.id);
            const isDone = practiceData !== null && practiceData !== undefined;

            const questionLink = document.createElement('a');
            questionLink.href = `practice.html?id=${questionData.id}`;
            questionLink.textContent = questionData.question;

            if (isDone) {
                questionItem.classList.add('question-done');
                hasPracticeData = true;
            }
            
            questionItem.appendChild(questionLink);
            groupContainer.appendChild(questionItem);
        }
        questionListContainer.appendChild(groupContainer);

        downloadAllResultsBtn.disabled = !hasPracticeData;
    }

    groupSelector.addEventListener('change', async (event) => {
        await displayGroup(event.target.value);
    });

    downloadAllResultsBtn.addEventListener('click', async () => {
        const includeAudio = includeAudioCheckbox.checked;
        const allResults = [];
        const audioFiles = [];
        const favorites = [];

        const allData = await getAllData();

        allData.forEach(record => {
            const questionData = questions.find(q => q.id === record.id);
            if (questionData) {
                const result = {
                    'Question ID': record.id,
                    Question: questionData.question,
                    Transcription: record.results.transcription,
                    RefinedVersion: record.results.refined_version
                };

                if (includeAudio && record.audioBlob) {
                    const audioFileName = `question_${record.id}.webm`;
                    result['Audio File'] = `audio/${audioFileName}`;
                    audioFiles.push({ name: audioFileName, blob: record.audioBlob });
                }
                allResults.push(result);
            }

            if (record.results && record.results.matches) {
                record.results.matches.forEach(match => {
                    if (match.isFavorite) {
                        const favoriteEntry = {
                            'Question ID': record.id,
                            Transcription: match.transcription,
                            RefinedVersion: match.refined_version,
                            Highlight: ''
                        };
                        if (match.highlights) {
                            favoriteEntry.Highlight = match.highlights.map(h => `(${h.startOffset}, ${h.endOffset})`).join(', ');
                        }
                        favorites.push(favoriteEntry);
                    }
                });
            }
        });

        if (allResults.length > 0 || favorites.length > 0) {
            const workbook = XLSX.utils.book_new();

            if (allResults.length > 0) {
                const worksheet = XLSX.utils.json_to_sheet(allResults);
                if (includeAudio) {
                    const range = XLSX.utils.decode_range(worksheet['!ref']);
                    for (let R = range.s.r + 1; R <= range.e.r; ++R) {
                        const cell_address = {c:4, r:R}; // Adjusted for the new column
                        const cell_ref = XLSX.utils.encode_cell(cell_address);
                        const cell = worksheet[cell_ref];
                        if (cell && cell.v) {
                            cell.l = { Target: cell.v, Tooltip: "Click to play" };
                        }
                    }
                }
                XLSX.utils.book_append_sheet(workbook, worksheet, 'All Results');
            }

            if (favorites.length > 0) {
                const favWorksheet = XLSX.utils.json_to_sheet(favorites);
                XLSX.utils.book_append_sheet(workbook, favWorksheet, 'Favorites');
            }

            if (includeAudio && audioFiles.length > 0) {
                const zip = new JSZip();
                const audioFolder = zip.folder("audio");

                audioFiles.forEach(file => {
                    audioFolder.file(file.name, file.blob);
                });

                const xlsxData = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
                zip.file('opic_all_results.xlsx', new Blob([new Uint8Array(xlsxData)], {type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));

                zip.generateAsync({type:"blob"}).then(function(content) {
                    const link = document.createElement('a');
                    link.href = URL.createObjectURL(content);
                    link.download = "opic_results.zip";
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                });
            } else {
                XLSX.writeFile(workbook, 'opic_all_results.xlsx');
            }
        } else {
            alert('No practice results to download.');
        }
    });

    loadQuestions();
});