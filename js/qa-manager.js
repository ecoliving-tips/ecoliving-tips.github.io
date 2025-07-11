// Local Q&A Management System
class QAManager {
    constructor() {
        this.storageKey = 'syro_malabar_questions';
        this.questionDuration = 7 * 24 * 60 * 60 * 1000; // 1 week in milliseconds
        this.init();
    }

    init() {
        this.cleanExpiredQuestions();
        this.loadQuestions();
    }

    // Add new question
    addQuestion(questionData) {
        const questions = this.getQuestions();
        const newQuestion = {
            id: Date.now().toString(),
            timestamp: Date.now(),
            status: 'pending',
            ...questionData
        };
        
        questions.unshift(newQuestion); // Add to beginning
        this.saveQuestions(questions);
        return newQuestion.id;
    }

    // Get all questions
    getQuestions() {
        const stored = localStorage.getItem(this.storageKey);
        return stored ? JSON.parse(stored) : [];
    }

    // Save questions
    saveQuestions(questions) {
        localStorage.setItem(this.storageKey, JSON.stringify(questions));
    }

    // Clean expired questions (older than 1 week)
    cleanExpiredQuestions() {
        const questions = this.getQuestions();
        const cutoffTime = Date.now() - this.questionDuration;
        const validQuestions = questions.filter(q => q.timestamp > cutoffTime);
        this.saveQuestions(validQuestions);
    }

    // Get questions for display (including time remaining)
    getQuestionsWithTimeRemaining() {
        const questions = this.getQuestions();
        return questions.map(question => {
            const timeRemaining = this.questionDuration - (Date.now() - question.timestamp);
            const daysRemaining = Math.ceil(timeRemaining / (24 * 60 * 60 * 1000));
            return {
                ...question,
                daysRemaining: Math.max(0, daysRemaining),
                expired: timeRemaining <= 0
            };
        });
    }

    // Add reply to question
    addReply(questionId, replyData) {
        const questions = this.getQuestions();
        const questionIndex = questions.findIndex(q => q.id === questionId);
        
        if (questionIndex !== -1) {
            questions[questionIndex].reply = {
                content: replyData.content,
                timestamp: Date.now(),
                author: 'Almighty One'
            };
            questions[questionIndex].status = 'answered';
            this.saveQuestions(questions);
            return true;
        }
        return false;
    }

    // Format date for display
    formatDate(timestamp) {
        return new Date(timestamp).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    }
}

// Initialize Q&A Manager
const qaManager = new QAManager();
