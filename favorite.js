import { getAllData } from './db.js';

document.addEventListener('DOMContentLoaded', async () => {
    const favoritesContainer = document.getElementById('favorites-container');

    try {
        const allData = await getAllData();
        const favorites = [];

        allData.forEach(record => {
            if (record.results && record.results.matches) {
                record.results.matches.forEach(match => {
                    if (match.isFavorite) {
                        favorites.push({
                            questionId: record.id,
                            ...match
                        });
                    }
                });
            }
        });

        if (favorites.length === 0) {
            favoritesContainer.innerHTML = '<p>You haven\'t favorited any sentences yet.</p>';
            return;
        }

        let favoritesHtml = '<h4>Favorite Sentences:</h4>';
        favorites.forEach(fav => {
            let refinedVersionHtml = fav.refined_version;
            if (fav.highlights) {
                fav.highlights.forEach(h => {
                    refinedVersionHtml = refinedVersionHtml.replace(h.text, `<mark>${h.text}</mark>`);
                });
            }

            favoritesHtml += `
                <div class="match-card">
                    <div class="match-card-nav">
                        <a href="practice.html?id=${fav.questionId}" class="view-question-link">Go to question</a>
                        <button class="btn-fold">Fold</button>
                    </div>
                    <p class="match-card__transcription">${fav.transcription}</p>
                    <p class="match-card__refined-version">${refinedVersionHtml}</p>
                </div>
            `;
        });

        favoritesContainer.innerHTML = favoritesHtml;

        favoritesContainer.addEventListener('click', (event) => {
            if (event.target.classList.contains('btn-fold')) {
                const matchCard = event.target.closest('.match-card');
                if (matchCard) {
                    const transcription = matchCard.querySelector('.match-card__transcription');
                    if (transcription) {
                        if (transcription.style.display === 'none') {
                            transcription.style.display = 'block';
                            event.target.textContent = 'Fold';
                        } else {
                            transcription.style.display = 'none';
                            event.target.textContent = 'Unfold';
                        }
                    }
                }
            }
        });

    } catch (error) {
        console.error('Failed to load favorites:', error);
        favoritesContainer.innerHTML = '<p>There was an error loading your favorites.</p>';
    }
});
