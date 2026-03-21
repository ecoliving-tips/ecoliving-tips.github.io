// Swaram - Internationalization (i18n)
let translations = {};
let currentLang = localStorage.getItem('swaram-lang') || 'en';

(async function initI18n() {
    try {
        const res = await fetch('/i18n/translations.json');
        translations = await res.json();
        applyLanguage(currentLang);
    } catch (e) {
        // Silently fail — English hardcoded in HTML is the fallback
    }
})();

function switchLanguage() {
    currentLang = currentLang === 'en' ? 'ml' : 'en';
    localStorage.setItem('swaram-lang', currentLang);
    applyLanguage(currentLang);
}

function applyLanguage(lang) {
    const t = translations[lang];
    if (!t) return;

    // Update indicator
    const indicator = document.getElementById('lang-indicator');
    if (indicator) indicator.textContent = lang === 'en' ? 'EN' : 'ML';

    // Update html lang attribute
    document.documentElement.lang = lang === 'en' ? 'en-IN' : 'ml';

    // Update all data-i18n elements
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        if (t[key]) {
            el.textContent = t[key];
        }
    });

    // Update all data-i18n-placeholder elements
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
        const key = el.getAttribute('data-i18n-placeholder');
        if (t[key]) {
            el.placeholder = t[key];
        }
    });

    // Add/remove Malayalam font class
    if (lang === 'ml') {
        document.body.classList.add('lang-ml');
    } else {
        document.body.classList.remove('lang-ml');
    }
}

// Helper for JS-rendered content: returns translated string or fallback
function t(key, fallback) {
    const dict = translations[currentLang];
    return (dict && dict[key]) || fallback || key;
}
