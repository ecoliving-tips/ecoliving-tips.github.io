// Swaram - AI Chord Generator
// YouTube IFrame API + Chord Timeline Sync

// ===== Configuration =====
const API_ENDPOINT = 'https://swaram-chord-service.onrender.com/analyze-upload';
const USE_MOCK_DATA = false;

// ===== State =====
let player = null;
let currentVideoId = null;
let chordData = null;
let currentTranspose = 0;
let originalKey = 'C';
let syncInterval = null;
let isPlaying = false;
let selectedFile = null;
let audioPlayer = null;
let audioObjectUrl = null;

// ===== i18n Helper =====
function t(key) {
    return (typeof translations !== 'undefined' && typeof currentLang !== 'undefined')
        ? translations[currentLang]?.[key] : null;
}

// ===== Mock Data for Testing =====
const MOCK_CHORD_DATA = {
    videoId: 'dQw4w9WgXcQ',
    key: 'C',
    bpm: 120,
    timeSignature: '4/4',
    chords: [
        { time: 0.0, duration: 2.0, chord: 'C' },
        { time: 2.0, duration: 2.0, chord: 'Am' },
        { time: 4.0, duration: 2.0, chord: 'F' },
        { time: 6.0, duration: 2.0, chord: 'G' },
        { time: 8.0, duration: 4.0, chord: 'C' },
        { time: 12.0, duration: 2.0, chord: 'Am' },
        { time: 14.0, duration: 2.0, chord: 'F' },
        { time: 16.0, duration: 2.0, chord: 'G' },
        { time: 18.0, duration: 2.0, chord: 'Em' },
        { time: 20.0, duration: 4.0, chord: 'Am' },
        { time: 24.0, duration: 4.0, chord: 'F' },
        { time: 28.0, duration: 4.0, chord: 'G' },
        { time: 32.0, duration: 2.0, chord: 'C' },
        { time: 34.0, duration: 2.0, chord: 'G' },
        { time: 36.0, duration: 4.0, chord: 'Am' },
        { time: 40.0, duration: 4.0, chord: 'F' },
        { time: 44.0, duration: 2.0, chord: 'C' },
        { time: 46.0, duration: 2.0, chord: 'G' },
        { time: 48.0, duration: 8.0, chord: 'C' },
    ]
};

// ===== YouTube IFrame API Callback =====
function onYouTubeIframeAPIReady() {
    // Player will be created when chords are loaded
}

// ===== Initialization =====
document.addEventListener('DOMContentLoaded', function() {
    const generateBtn = document.getElementById('generate-btn');
    const urlInput = document.getElementById('youtube-url');
    const transposeDown = document.getElementById('transpose-down');
    const transposeUp = document.getElementById('transpose-up');
    const transposeReset = document.getElementById('transpose-reset');
    const saveBtn = document.getElementById('save-song-btn');
    const shareBtn = document.getElementById('share-chords-btn');
    const printBtn = document.getElementById('print-chords-btn');

    // File upload handling
    const uploadArea = document.getElementById('upload-area');
    const audioFileInput = document.getElementById('audio-file');
    const uploadContent = document.getElementById('upload-content');
    const uploadFileInfo = document.getElementById('upload-file-info');
    const uploadFileName = document.getElementById('upload-file-name');
    const uploadRemove = document.getElementById('upload-remove');

    if (uploadArea && audioFileInput) {
        // Click to browse
        uploadArea.addEventListener('click', function(e) {
            if (e.target.closest('.upload-remove')) return;
            audioFileInput.click();
        });

        // File selected via input
        audioFileInput.addEventListener('change', function() {
            if (this.files && this.files[0]) {
                setSelectedFile(this.files[0]);
            }
        });

        // Drag and drop
        uploadArea.addEventListener('dragover', function(e) {
            e.preventDefault();
            uploadArea.classList.add('drag-over');
        });
        uploadArea.addEventListener('dragleave', function() {
            uploadArea.classList.remove('drag-over');
        });
        uploadArea.addEventListener('drop', function(e) {
            e.preventDefault();
            uploadArea.classList.remove('drag-over');
            if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                setSelectedFile(e.dataTransfer.files[0]);
            }
        });

        // Remove file
        if (uploadRemove) {
            uploadRemove.addEventListener('click', function(e) {
                e.stopPropagation();
                clearSelectedFile();
            });
        }
    }

    if (generateBtn) {
        generateBtn.addEventListener('click', handleGenerate);
    }

    if (urlInput) {
        urlInput.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                handleGenerate();
            }
        });
    }

    if (transposeDown) transposeDown.addEventListener('click', () => doTranspose(-1));
    if (transposeUp) transposeUp.addEventListener('click', () => doTranspose(1));
    if (transposeReset) transposeReset.addEventListener('click', () => doTranspose(0, true));

    if (saveBtn) saveBtn.addEventListener('click', saveAsSong);
    if (shareBtn) shareBtn.addEventListener('click', shareChords);
    if (printBtn) printBtn.addEventListener('click', printChords);

    // Check for URL parameter
    const urlParams = new URLSearchParams(window.location.search);
    const videoParam = urlParams.get('v');
    if (videoParam && urlInput) {
        urlInput.value = `https://www.youtube.com/watch?v=${videoParam}`;
    }
});

// ===== File Selection =====
function setSelectedFile(file) {
    selectedFile = file;
    const uploadContent = document.getElementById('upload-content');
    const uploadFileInfo = document.getElementById('upload-file-info');
    const uploadFileName = document.getElementById('upload-file-name');
    const uploadArea = document.getElementById('upload-area');

    if (uploadContent) uploadContent.style.display = 'none';
    if (uploadFileInfo) uploadFileInfo.style.display = 'flex';
    if (uploadFileName) uploadFileName.textContent = file.name;
    if (uploadArea) uploadArea.classList.add('has-file');
}

function clearSelectedFile() {
    selectedFile = null;
    const audioFileInput = document.getElementById('audio-file');
    const uploadContent = document.getElementById('upload-content');
    const uploadFileInfo = document.getElementById('upload-file-info');
    const uploadArea = document.getElementById('upload-area');

    if (audioFileInput) audioFileInput.value = '';
    if (uploadContent) uploadContent.style.display = '';
    if (uploadFileInfo) uploadFileInfo.style.display = 'none';
    if (uploadArea) uploadArea.classList.remove('has-file');
}

// ===== Generate Handler =====
async function handleGenerate() {
    const urlInput = document.getElementById('youtube-url');
    const url = urlInput ? urlInput.value.trim() : '';

    // Must have an audio file
    if (!selectedFile) {
        showError(t('generate_error_no_file') || 'Please select an audio file to analyze.');
        return;
    }

    // Check file size (30MB max)
    if (selectedFile.size > 30 * 1024 * 1024) {
        showError(t('generate_error_file_size') || 'File is too large (max 30MB).');
        return;
    }

    // Extract YouTube video ID if URL provided (for video sync)
    const videoId = url ? extractYouTubeId(url) : null;

    showLoading();
    hideError();
    stopSyncLoop();

    // Clean up previous audio player
    if (audioPlayer) {
        audioPlayer.pause();
        audioPlayer.src = '';
        audioPlayer = null;
    }
    if (audioObjectUrl) {
        URL.revokeObjectURL(audioObjectUrl);
        audioObjectUrl = null;
    }

    // Reset visibility
    const videoContainer = document.querySelector('.video-container');
    if (videoContainer) videoContainer.style.display = '';
    const audioContainer = document.getElementById('audio-player-container');
    if (audioContainer) audioContainer.style.display = 'none';

    try {
        if (USE_MOCK_DATA) {
            await new Promise(resolve => setTimeout(resolve, 1500));
            chordData = JSON.parse(JSON.stringify(MOCK_CHORD_DATA));
            chordData.videoId = videoId || 'upload';
        } else {
            // Upload file to chord detection service
            const formData = new FormData();
            formData.append('file', selectedFile);
            formData.append('video_id', videoId || '');

            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 300000); // 5 min timeout

            const response = await fetch(API_ENDPOINT, {
                method: 'POST',
                body: formData,
                signal: controller.signal
            });
            clearTimeout(timeout);

            if (!response.ok) {
                const errBody = await response.text();
                throw new Error(errBody || `Service error (${response.status})`);
            }

            chordData = await response.json();
        }

        if (!chordData || !chordData.chords || chordData.chords.length === 0) {
            throw new Error('No chords detected');
        }

        currentVideoId = videoId || chordData.videoId || 'upload';
        originalKey = chordData.key || 'C';
        currentTranspose = 0;

        hideLoading();
        showPlayerSection();

        // Only show YouTube player if a valid video ID was provided
        if (videoId) {
            const audioContainer = document.getElementById('audio-player-container');
            if (audioContainer) audioContainer.style.display = 'none';
            initializePlayer(videoId);
        } else {
            // Hide the video container, show audio player
            const videoContainer = document.querySelector('.video-container');
            if (videoContainer) videoContainer.style.display = 'none';
            initializeAudioPlayer(selectedFile);
        }

        renderChordTimeline();
        updateMetaDisplay();

        // Update URL if we have a video ID
        if (videoId) {
            const newUrl = `${window.location.pathname}?v=${videoId}`;
            window.history.replaceState({ videoId }, '', newUrl);
        }

    } catch (error) {
        console.error('Generation error:', error);
        hideLoading();
        showError(t('generate_error_msg') || 'Unable to generate chords. Please try again.');
    }
}

// ===== YouTube Player =====
function initializePlayer(videoId) {
    const playerContainer = document.getElementById('youtube-player');
    if (!playerContainer) return;

    // Clear existing player
    playerContainer.innerHTML = '';

    // Create player
    player = new YT.Player('youtube-player', {
        videoId: videoId,
        height: '360',
        width: '100%',
        playerVars: {
            'playsinline': 1,
            'rel': 0,
            'modestbranding': 1
        },
        events: {
            'onReady': onPlayerReady,
            'onStateChange': onPlayerStateChange
        }
    });
}

function onPlayerReady(event) {
    // Player is ready
    startSyncLoop();
}

function onPlayerStateChange(event) {
    isPlaying = event.data === YT.PlayerState.PLAYING;
    if (isPlaying) {
        startSyncLoop();
    } else {
        stopSyncLoop();
    }
}

// ===== HTML5 Audio Player =====
function initializeAudioPlayer(file) {
    // Clean up previous object URL
    if (audioObjectUrl) {
        URL.revokeObjectURL(audioObjectUrl);
        audioObjectUrl = null;
    }

    const audioEl = document.getElementById('audio-player');
    const container = document.getElementById('audio-player-container');
    if (!audioEl || !container) return;

    audioObjectUrl = URL.createObjectURL(file);
    audioEl.src = audioObjectUrl;
    audioPlayer = audioEl;
    container.style.display = 'block';

    const playBtn = document.getElementById('audio-play-btn');
    const seekInput = document.getElementById('audio-seek-input');

    // Remove old listeners by replacing elements (prevents duplicates on re-generate)
    const newPlayBtn = playBtn.cloneNode(true);
    playBtn.parentNode.replaceChild(newPlayBtn, playBtn);
    newPlayBtn.addEventListener('click', toggleAudioPlayback);

    const newSeek = seekInput.cloneNode(true);
    seekInput.parentNode.replaceChild(newSeek, seekInput);
    newSeek.addEventListener('input', function() {
        if (audioPlayer.duration) {
            audioPlayer.currentTime = (this.value / 100) * audioPlayer.duration;
        }
    });

    // Audio element listeners (use onX to avoid duplicates)
    audioEl.onloadedmetadata = function() {
        document.getElementById('audio-duration').textContent = formatTime(audioEl.duration);
    };

    audioEl.onplay = function() {
        isPlaying = true;
        updateAudioPlayIcon(true);
        startSyncLoop();
    };

    audioEl.onpause = function() {
        isPlaying = false;
        updateAudioPlayIcon(false);
        stopSyncLoop();
    };

    audioEl.onended = function() {
        isPlaying = false;
        updateAudioPlayIcon(false);
        stopSyncLoop();
    };
}

function toggleAudioPlayback() {
    if (!audioPlayer) return;
    if (audioPlayer.paused) {
        audioPlayer.play();
    } else {
        audioPlayer.pause();
    }
}

function updateAudioPlayIcon(playing) {
    const playIcon = document.getElementById('audio-play-icon');
    const pauseIcon = document.getElementById('audio-pause-icon');
    if (playIcon) playIcon.style.display = playing ? 'none' : '';
    if (pauseIcon) pauseIcon.style.display = playing ? '' : 'none';
}

// ===== Sync Loop =====
function startSyncLoop() {
    if (syncInterval) return;
    syncInterval = setInterval(updateChordSync, 100);
}

function stopSyncLoop() {
    if (syncInterval) {
        clearInterval(syncInterval);
        syncInterval = null;
    }
}

function updateChordSync() {
    if (!chordData || !chordData.chords) return;

    let currentTime = 0;
    let duration = 0;

    if (audioPlayer && audioPlayer.src) {
        currentTime = audioPlayer.currentTime;
        duration = audioPlayer.duration || 0;
        // Update audio player UI
        const seekInput = document.getElementById('audio-seek-input');
        const seekProgress = document.getElementById('audio-seek-progress');
        const timeEl = document.getElementById('audio-current-time');
        if (duration > 0) {
            const pct = (currentTime / duration) * 100;
            if (seekInput) seekInput.value = pct;
            if (seekProgress) seekProgress.style.width = pct + '%';
        }
        if (timeEl) timeEl.textContent = formatTime(currentTime);
    } else if (player && player.getCurrentTime) {
        currentTime = player.getCurrentTime();
        duration = player.getDuration();
    } else {
        return;
    }

    // Update time display
    updateTimeDisplay(currentTime);

    // Update progress bar
    if (duration > 0) {
        const progressPercent = (currentTime / duration) * 100;
        const progressBar = document.getElementById('timeline-progress-bar');
        if (progressBar) {
            progressBar.style.width = `${progressPercent}%`;
        }
    }

    // Find current chord
    const activeChord = chordData.chords.find(c =>
        currentTime >= c.time && currentTime < c.time + c.duration
    );

    // Update current chord display
    const currentChordEl = document.getElementById('current-chord');
    if (currentChordEl && activeChord) {
        const transposedChord = transposeChord(activeChord.chord, currentTranspose);
        currentChordEl.textContent = transposedChord;
        currentChordEl.setAttribute('data-original', activeChord.chord);
    }

    // Highlight chord in timeline
    highlightActiveChord(currentTime);
}

// ===== Chord Timeline Rendering =====
function renderChordTimeline() {
    const timeline = document.getElementById('chord-timeline');
    if (!timeline || !chordData) return;

    timeline.innerHTML = '';

    // Calculate total duration
    const totalDuration = chordData.chords.reduce((sum, c) => Math.max(sum, c.time + c.duration), 0);
    const scaleFactor = Math.max(60, totalDuration); // Minimum scale of 60 seconds

    chordData.chords.forEach((chordItem, index) => {
        const chordBlock = document.createElement('div');
        chordBlock.className = 'chord-block';
        chordBlock.dataset.index = index;
        chordBlock.dataset.time = chordItem.time;
        chordBlock.dataset.duration = chordItem.duration;
        chordBlock.dataset.chord = chordItem.chord;

        // Width proportional to duration (minimum 60px, maximum 200px)
        const widthPx = Math.min(200, Math.max(60, chordItem.duration * 40));
        chordBlock.style.width = `${widthPx}px`;

        // Inner HTML with chord name (chord-name class enables chord-diagrams.js delegated handler)
        chordBlock.innerHTML = `
            <span class="chord-block-name chord-name" data-original="${chordItem.chord}">${chordItem.chord}</span>
            <span class="chord-block-time">${formatTime(chordItem.time)}</span>
        `;

        // Click on chord block background → seek to time
        chordBlock.addEventListener('click', function(e) {
            // Don't seek if user clicked the chord name (that opens diagram via chord-diagrams.js)
            if (e.target.closest('.chord-name')) return;
            seekToChord(chordItem.time);
        });

        timeline.appendChild(chordBlock);
    });
}

function highlightActiveChord(currentTime) {
    const timeline = document.getElementById('chord-timeline');
    if (!timeline) return;

    const blocks = timeline.querySelectorAll('.chord-block');
    let activeFound = false;

    blocks.forEach(block => {
        const blockTime = parseFloat(block.dataset.time);
        const blockDuration = parseFloat(block.dataset.duration);
        const blockEnd = blockTime + blockDuration;

        block.classList.remove('active', 'past');

        if (!activeFound && currentTime >= blockTime && currentTime < blockEnd) {
            block.classList.add('active');
            activeFound = true;

            // Scroll into view if needed
            const container = timeline.parentElement;
            const blockRect = block.getBoundingClientRect();
            const containerRect = container.getBoundingClientRect();

            if (blockRect.left < containerRect.left || blockRect.right > containerRect.right) {
                block.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
            }
        } else if (currentTime >= blockEnd) {
            block.classList.add('past');
        }
    });
}

function seekToChord(time) {
    if (audioPlayer) {
        audioPlayer.currentTime = time;
        if (audioPlayer.paused) audioPlayer.play();
    } else if (player && player.seekTo) {
        player.seekTo(time, true);
        player.playVideo();
    }
}

// ===== Transpose =====
function doTranspose(delta, reset = false) {
    if (reset) {
        currentTranspose = 0;
    } else {
        currentTranspose = ((currentTranspose + delta) % 12 + 12) % 12;
    }

    // Update transpose display
    const transposeValue = document.getElementById('transpose-value');
    if (transposeValue) {
        const display = currentTranspose === 0 ? '0' : (currentTranspose <= 6 ? `+${currentTranspose}` : `${currentTranspose - 12}`);
        transposeValue.textContent = display;
    }

    // Update key display
    const keyEl = document.getElementById('generate-key');
    if (keyEl && originalKey) {
        keyEl.textContent = transposeChord(originalKey, currentTranspose);
    }

    // Update all chord blocks
    document.querySelectorAll('.chord-block-name').forEach(el => {
        const original = el.getAttribute('data-original');
        if (original) {
            el.textContent = transposeChord(original, currentTranspose);
        }
    });

    // Update current chord display
    updateChordSync();
}

function transposeChord(chord, semitones) {
    if (semitones === 0) return chord;

    const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const FLAT_MAP = { 'Db': 'C#', 'Eb': 'D#', 'Fb': 'E', 'Gb': 'F#', 'Ab': 'G#', 'Bb': 'A#', 'Cb': 'B' };

    // Handle slash chords like Am/E
    if (chord.includes('/')) {
        const parts = chord.split('/');
        return transposeChord(parts[0], semitones) + '/' + transposeChord(parts[1], semitones);
    }

    // Extract root note and quality
    const match = chord.match(/^([A-G][#b]?)(.*)/);
    if (!match) return chord;

    let root = match[1];
    const quality = match[2];

    // Normalize flats to sharps
    if (FLAT_MAP[root]) root = FLAT_MAP[root];

    const rootIndex = NOTES.indexOf(root);
    if (rootIndex === -1) return chord;

    const newIndex = (rootIndex + semitones + 12) % 12;
    return NOTES[newIndex] + quality;
}

// ===== Meta Display =====
function updateMetaDisplay() {
    if (!chordData) return;

    const keyEl = document.getElementById('generate-key');
    const bpmEl = document.getElementById('generate-bpm');
    const timeEl = document.getElementById('generate-time');

    if (keyEl) keyEl.textContent = chordData.key || '-';
    if (bpmEl) bpmEl.textContent = chordData.bpm || '-';
    if (timeEl) timeEl.textContent = chordData.timeSignature || '-';
}

// ===== Utilities =====
function extractYouTubeId(url) {
    const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^\?\&\s]+)/);
    return match ? match[1] : null;
}

function formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function updateTimeDisplay(seconds) {
    const timeEl = document.getElementById('current-time');
    if (timeEl) {
        timeEl.textContent = formatTime(seconds);
    }
}

// ===== UI Helpers =====
function showLoading() {
    const loading = document.getElementById('generate-loading');
    if (loading) loading.style.display = 'flex';

    const btn = document.getElementById('generate-btn');
    if (btn) {
        btn.disabled = true;
        btn.textContent = t('generating_text') || 'Generating...';
    }
}

function hideLoading() {
    const loading = document.getElementById('generate-loading');
    if (loading) loading.style.display = 'none';

    const btn = document.getElementById('generate-btn');
    if (btn) {
        btn.disabled = false;
        btn.textContent = t('generate_button') || 'Generate Chords';
    }
}

function showError(message) {
    const error = document.getElementById('generate-error');
    if (error) {
        error.textContent = message;
        error.style.display = 'block';
    }
}

function hideError() {
    const error = document.getElementById('generate-error');
    if (error) {
        error.style.display = 'none';
    }
}

function showPlayerSection() {
    const section = document.getElementById('player-section');
    if (section) section.style.display = 'block';
}

// ===== Actions =====
function saveAsSong() {
    if (!chordData) return;

    // Format chords as song file
    let chordContent = `{Intro}\n`;
    chordContent += `|| ${chordData.chords.slice(0, 4).map(c => c.chord).join(' | ')} ||\n\n`;
    chordContent += `{Verse 1}\n`;

    chordData.chords.forEach((c, i) => {
        chordContent += `[${c.chord}] `;
        if ((i + 1) % 4 === 0) chordContent += '\n';
    });

    const songData = {
        title: 'AI Generated Song',
        artist: 'Unknown',
        youtube: `https://www.youtube.com/watch?v=${currentVideoId}`,
        key: chordData.key,
        time: chordData.timeSignature,
        bpm: chordData.bpm,
        chords: chordContent
    };

    // For now, just log and alert
    console.log('Song data:', songData);
    alert(t('generate_save_success') || 'Save feature coming soon!');
}

function shareChords() {
    if (!currentVideoId) return;

    const shareUrl = `${window.location.origin}/generate.html?v=${currentVideoId}`;

    if (navigator.share) {
        navigator.share({
            title: t('generate_share_title') || 'AI Generated Chords - Swaram',
            text: t('generate_share_text') || 'Check out these chords I generated with Swaram AI!',
            url: shareUrl
        }).catch(() => {});
    } else {
        navigator.clipboard.writeText(shareUrl).then(() => {
            alert(t('link_copied') || 'Link copied to clipboard!');
        });
    }
}

function printChords() {
    window.print();
}

// ===== UPI Payment =====
function openUPI() {
    window.open('upi://pay?pa=7306025928@upi&pn=Swaram', '_blank');
}
