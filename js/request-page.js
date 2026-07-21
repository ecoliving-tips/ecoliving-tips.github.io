(function () {
    'use strict';

    const SUPABASE_URL = 'https://jfnccekkhffonkjkmxyf.supabase.co';
    const SUPABASE_KEY = 'sb_publishable_KJA4VzMAjt2WVEEg0JKMfg_lDrABAZK';
    const UPI_ID = '7306025928@upi';
    const REQUEST_MIN_FILL_MS = 1500;
    const REQUEST_THROTTLE_MS = 15000;
    const REQUEST_MAX_SONG_LEN = 180;
    const REQUEST_MAX_MSG_LEN = 1000;

    const formFirstSeenAt = Date.now();

    function getTranslatedText(key, fallback) {
        if (typeof translations === 'undefined' || typeof currentLang === 'undefined') {
            return fallback;
        }
        return translations[currentLang]?.[key] || fallback;
    }

    function shouldThrottleSubmit() {
        try {
            const last = Number(sessionStorage.getItem('swaram-last-request-submit-at') || '0');
            if (last && (Date.now() - last) < REQUEST_THROTTLE_MS) {
                return true;
            }
            sessionStorage.setItem('swaram-last-request-submit-at', String(Date.now()));
            return false;
        } catch {
            return false;
        }
    }

    function normalizeInput(value, maxLen) {
        return (value || '').replace(/\s+/g, ' ').trim().slice(0, maxLen);
    }

    function resetForm() {
        const form = document.getElementById('request-form');
        const successMessage = document.getElementById('success-message');
        const errorMessage = document.getElementById('error-message');
        if (form) {
            form.reset();
            form.style.display = 'block';
        }
        if (successMessage) successMessage.style.display = 'none';
        if (errorMessage) errorMessage.style.display = 'none';
    }

    function isMobileDevice() {
        return navigator.maxTouchPoints > 0 && window.matchMedia('(pointer: coarse)').matches;
    }

    function copyUPIId() {
        navigator.clipboard.writeText(UPI_ID).then(() => {
            const btn = document.querySelector('.qr-modal-copy');
            if (!btn) return;
            btn.textContent = '\u2713';
            setTimeout(() => {
                btn.textContent = getTranslatedText('copy_upi_id', 'Copy');
            }, 1500);
        }).catch(() => {});
    }

    function showQRModal() {
        const existing = document.getElementById('qr-modal');
        if (existing) {
            existing.style.display = 'flex';
            return;
        }

        const modal = document.createElement('div');
        modal.id = 'qr-modal';
        modal.className = 'qr-modal-overlay';

        const content = document.createElement('div');
        content.className = 'qr-modal-content';

        const closeBtn = document.createElement('button');
        closeBtn.className = 'qr-modal-close';
        closeBtn.setAttribute('aria-label', 'Close');
        closeBtn.innerHTML = '&times;';

        const title = document.createElement('h3');
        title.setAttribute('data-i18n', 'qr_modal_title');
        title.textContent = getTranslatedText('qr_modal_title', 'Scan to Donate via UPI');

        const image = document.createElement('img');
        image.src = '/assets/donate-qr.png';
        image.alt = 'UPI QR Code for donation';
        image.className = 'qr-modal-img';

        const upiLine = document.createElement('p');
        upiLine.className = 'qr-modal-upi-id';
        upiLine.append('UPI ID: ');

        const strong = document.createElement('strong');
        strong.textContent = UPI_ID;
        upiLine.appendChild(strong);

        const copyBtn = document.createElement('button');
        copyBtn.className = 'qr-modal-copy';
        copyBtn.type = 'button';
        copyBtn.setAttribute('data-i18n', 'copy_upi_id');
        copyBtn.textContent = getTranslatedText('copy_upi_id', 'Copy');
        copyBtn.addEventListener('click', copyUPIId);
        upiLine.appendChild(document.createTextNode(' '));
        upiLine.appendChild(copyBtn);

        const hint = document.createElement('p');
        hint.className = 'qr-modal-hint';
        hint.setAttribute('data-i18n', 'qr_modal_hint');
        hint.textContent = getTranslatedText('qr_modal_hint', 'Open any UPI app on your phone and scan this QR code');

        content.appendChild(closeBtn);
        content.appendChild(title);
        content.appendChild(image);
        content.appendChild(upiLine);
        content.appendChild(hint);
        modal.appendChild(content);
        document.body.appendChild(modal);

        closeBtn.addEventListener('click', () => {
            modal.style.display = 'none';
        });

        modal.addEventListener('click', (event) => {
            if (event.target === modal) {
                modal.style.display = 'none';
            }
        });
    }

    function openUPI(event) {
        if (event) event.preventDefault();
        if (isMobileDevice()) {
            window.open(`upi://pay?pa=${UPI_ID}&pn=Swaram`, '_blank');
            return;
        }
        showQRModal();
    }

    function initRazorpayLazyLoad() {
        const container = document.getElementById('razorpay-btn-container');
        if (!container) return;

        let loaded = false;
        function loadRazorpay() {
            if (loaded) return;
            loaded = true;
            const form = document.createElement('form');
            const script = document.createElement('script');
            script.src = 'https://checkout.razorpay.com/v1/payment-button.js';
            script.setAttribute('data-payment_button_id', 'pl_SadQoYekBnNHJC');
            script.async = true;
            form.appendChild(script);
            container.appendChild(form);
        }

        if ('IntersectionObserver' in window) {
            const observer = new IntersectionObserver((entries) => {
                if (entries[0].isIntersecting) {
                    loadRazorpay();
                    observer.disconnect();
                }
            }, { rootMargin: '300px' });
            observer.observe(container);
            return;
        }

        loadRazorpay();
    }

    async function handleSubmit(event) {
        event.preventDefault();

        const submitBtn = document.getElementById('submit-btn');
        const form = document.getElementById('request-form');
        const successMessage = document.getElementById('success-message');
        const errorMessage = document.getElementById('error-message');

        if (!submitBtn || !form) return;

        submitBtn.disabled = true;
        submitBtn.textContent = getTranslatedText('submitting', 'Submitting...');

        const honeypot = document.getElementById('website')?.value || '';
        if (honeypot.trim()) {
            if (errorMessage) errorMessage.style.display = 'block';
            submitBtn.disabled = false;
            submitBtn.textContent = getTranslatedText('submit_request', 'Submit Request');
            return;
        }

        if ((Date.now() - formFirstSeenAt) < REQUEST_MIN_FILL_MS || shouldThrottleSubmit()) {
            if (errorMessage) errorMessage.style.display = 'block';
            submitBtn.disabled = false;
            submitBtn.textContent = getTranslatedText('submit_request', 'Submit Request');
            return;
        }

        const email = normalizeInput(document.getElementById('email')?.value, 254);
        const songTitle = normalizeInput(document.getElementById('song-title')?.value, REQUEST_MAX_SONG_LEN);
        const message = normalizeInput(document.getElementById('message')?.value, REQUEST_MAX_MSG_LEN);

        if (!email || !songTitle) {
            if (errorMessage) errorMessage.style.display = 'block';
            submitBtn.disabled = false;
            submitBtn.textContent = getTranslatedText('submit_request', 'Submit Request');
            return;
        }

        try {
            const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
            const { error } = await supabaseClient
                .from('song_requests')
                .insert([{ email, song_title: songTitle, message, status: 'pending' }]);
            if (error) throw error;

            form.style.display = 'none';
            if (successMessage) successMessage.style.display = 'block';
            if (errorMessage) errorMessage.style.display = 'none';
        } catch (error) {
            console.error('Request submit error:', error);
            if (errorMessage) errorMessage.style.display = 'block';
        }

        submitBtn.disabled = false;
        submitBtn.textContent = getTranslatedText('submit_request', 'Submit Request');
    }

    function initRequestPage() {
        const form = document.getElementById('request-form');
        const submitAnother = document.getElementById('submit-another-btn');
        const upiLink = document.getElementById('upi-pay-link');

        if (form) form.addEventListener('submit', handleSubmit);
        if (submitAnother) submitAnother.addEventListener('click', resetForm);
        if (upiLink) upiLink.addEventListener('click', openUPI);

        initRazorpayLazyLoad();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initRequestPage);
    } else {
        initRequestPage();
    }
})();
