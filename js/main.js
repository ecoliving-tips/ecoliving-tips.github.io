document.addEventListener('DOMContentLoaded', function() {
    // Smooth scrolling for anchor links
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function(e) {
            e.preventDefault();
            
            const targetId = this.getAttribute('href');
            const targetElement = document.querySelector(targetId);
            
            if (targetElement) {
                window.scrollTo({
                    top: targetElement.offsetTop - 80, // Offset for the sticky header
                    behavior: 'smooth'
                });
            }
        });
    });

    // Form submission success handling
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('success') === 'true') {
        showSuccessMessage();
    }

    function showSuccessMessage() {
        const successDiv = document.createElement('div');
        successDiv.className = 'form-success-message';
        successDiv.innerHTML = `
            <div class="success-content">
                <h3>✅ Message Sent Successfully!</h3>
                <p>Thank you for reaching out! Your message has been sent directly to almighty33one@gmail.com and you'll receive a personal response within 24-48 hours.</p>
                <p>🎵 In the meantime, feel free to explore our <a href="https://www.youtube.com/@almightyone8205" target="_blank">YouTube tutorials</a>!</p>
                <button onclick="this.parentElement.parentElement.remove()" class="btn btn-small">Close</button>
            </div>
        `;
        
        document.body.insertBefore(successDiv, document.body.firstChild);
        
        // Auto-remove after 10 seconds
        setTimeout(() => {
            if (successDiv.parentElement) {
                successDiv.remove();
            }
        }, 10000);
    }
});
