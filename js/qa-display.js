// Q&A Display and Form Handling
document.addEventListener('DOMContentLoaded', function() {
    // Initialize Q&A display
    displayQuestions();
    
    // Handle form submission
    const questionForm = document.getElementById('localQuestionForm');
    if (questionForm) {
        questionForm.addEventListener('submit', function(e) {
            e.preventDefault();
            submitQuestion();
        });
    }
    
    // Check if this is an admin view (you can add admin panel later)
    if (window.location.hash === '#admin') {
        showAdminPanel();
    }
});

function submitQuestion() {
    const form = document.getElementById('localQuestionForm');
    const formData = new FormData(form);
    
    const questionData = {
        title: formData.get('question_title'),
        category: formData.get('category') || 'other',
        details: formData.get('question_details'),
        userName: formData.get('user_name'),
        userEmail: formData.get('user_email')
    };
    
    // Validate required fields
    if (!questionData.title || !questionData.details || !questionData.userName || !questionData.userEmail) {
        alert('Please fill in all required fields.');
        return;
    }
    
    // Add question to storage
    const questionId = qaManager.addQuestion(questionData);
    
    // Show success message
    document.getElementById('questionSuccessMessage').style.display = 'block';
    
    // Reset form
    form.reset();
    
    // Refresh questions display
    displayQuestions();
    
    // Scroll to success message
    document.getElementById('questionSuccessMessage').scrollIntoView({ behavior: 'smooth' });
    
    // Hide success message after 5 seconds
    setTimeout(() => {
        document.getElementById('questionSuccessMessage').style.display = 'none';
    }, 5000);
}

function displayQuestions() {
    const container = document.getElementById('liveQuestionsContainer');
    const sampleQuestions = document.getElementById('sampleQuestions');
    const questions = qaManager.getQuestionsWithTimeRemaining();
    
    if (questions.length === 0) {
        container.innerHTML = '<p class="no-questions">No recent questions. Be the first to ask!</p>';
        return;
    }
    
    // Hide sample questions if we have real questions
    if (questions.length > 0 && sampleQuestions) {
        sampleQuestions.style.display = 'none';
    }
    
    container.innerHTML = questions.map(question => createQuestionHTML(question)).join('');
}

function createQuestionHTML(question) {
    const categoryDisplayNames = {
        'syro-malabar-holy-mass': 'Syro Malabar Holy Mass',
        'song-tutorials': 'Song Tutorials',
        'chord-progressions': 'Chord Progressions',
        'ernakulam-tune': 'Ernakulam Tune',
        'keyboard-techniques': 'Keyboard Techniques',
        'liturgical-music': 'Liturgical Music',
        'equipment-advice': 'Equipment Advice',
        'background-music': 'Background Music',
        'mindful-living': 'Mindful Living',
        'other': 'Other'
    };
    
    const categoryDisplay = categoryDisplayNames[question.category] || question.category;
    const statusBadge = question.status === 'answered' ? 
        '<span class="status-badge answered">✅ Answered</span>' : 
        '<span class="status-badge pending">⏳ Pending</span>';
    
    const timeInfo = question.daysRemaining > 0 ? 
        `<span class="time-remaining">${question.daysRemaining} days remaining</span>` :
        '<span class="time-expired">Expired</span>';
    
    let html = `
        <article class="qa-item ${question.status}" data-question-id="${question.id}">
            <div class="question">
                <h3>${escapeHtml(question.title)}</h3>
                <div class="qa-meta">
                    <span class="category">${categoryDisplay}</span>
                    <span class="date">${qaManager.formatDate(question.timestamp)}</span>
                    <span class="asker">Asked by ${escapeHtml(question.userName)}</span>
                    ${statusBadge}
                    ${timeInfo}
                </div>
                <p class="question-detail">${escapeHtml(question.details)}</p>
            </div>
    `;
    
    if (question.reply) {
        html += `
            <div class="answer">
                <h4>Answer from ${escapeHtml(question.reply.author)}:</h4>
                <div class="reply-content">${escapeHtml(question.reply.content).replace(/\n/g, '<br>')}</div>
                <div class="answer-meta">
                    <span class="answerer">Answered on ${qaManager.formatDate(question.reply.timestamp)}</span>
                </div>
            </div>
        `;
    } else {
        // Add admin reply form (only visible when admin mode is enabled)
        html += `
            <div class="admin-reply-section" style="display: none;">
                <h4>Reply to this question:</h4>
                <textarea id="reply-${question.id}" rows="4" placeholder="Type your reply here..."></textarea>
                <button onclick="submitReply('${question.id}')" class="btn btn-small">Send Reply</button>
            </div>
        `;
    }
    
    html += '</article>';
    return html;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function submitReply(questionId) {
    const replyText = document.getElementById(`reply-${questionId}`).value.trim();
    
    if (!replyText) {
        alert('Please enter a reply.');
        return;
    }
    
    const success = qaManager.addReply(questionId, {
        content: replyText
    });
    
    if (success) {
        alert('Reply added successfully!');
        displayQuestions(); // Refresh display
    } else {
        alert('Error adding reply.');
    }
}

// Admin panel functionality
function showAdminPanel() {
    document.querySelectorAll('.admin-reply-section').forEach(section => {
        section.style.display = 'block';
    });
    
    // Add admin header
    const adminHeader = document.createElement('div');
    adminHeader.className = 'admin-header';
    adminHeader.innerHTML = `
        <div class="admin-notice">
            <h3>🔧 Admin Mode Active</h3>
            <p>You can now reply to questions. Replies will be emailed to users.</p>
            <button onclick="exportQuestions()" class="btn btn-small">Export Questions</button>
            <button onclick="location.hash = ''" class="btn btn-small">Exit Admin Mode</button>
        </div>
    `;
    
    const container = document.querySelector('.qa-content');
    container.insertBefore(adminHeader, container.firstChild);
}

function exportQuestions() {
    const questions = qaManager.getQuestions();
    const dataStr = JSON.stringify(questions, null, 2);
    const dataBlob = new Blob([dataStr], {type: 'application/json'});
    
    const link = document.createElement('a');
    link.href = URL.createObjectURL(dataBlob);
    link.download = `qa-export-${new Date().toISOString().split('T')[0]}.json`;
    link.click();
}
