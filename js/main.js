document.addEventListener('DOMContentLoaded', function() {
    // Mobile menu toggle functionality
    const mobileMenuToggle = document.querySelector('.mobile-menu-toggle');
    const nav = document.querySelector('nav');
    const navLinks = document.querySelectorAll('nav ul li a');

    if (mobileMenuToggle && nav) {
        mobileMenuToggle.addEventListener('click', function() {
            // Toggle menu visibility
            nav.classList.toggle('mobile-nav-open');
            mobileMenuToggle.classList.toggle('active');
            
            // Update aria-expanded attribute for accessibility
            const isExpanded = nav.classList.contains('mobile-nav-open');
            mobileMenuToggle.setAttribute('aria-expanded', isExpanded);
            
            // Prevent body scroll when menu is open
            if (isExpanded) {
                document.body.style.overflow = 'hidden';
            } else {
                document.body.style.overflow = '';
            }
        });

        // Close mobile menu when clicking on a navigation link
        navLinks.forEach(link => {
            link.addEventListener('click', function() {
                nav.classList.remove('mobile-nav-open');
                mobileMenuToggle.classList.remove('active');
                mobileMenuToggle.setAttribute('aria-expanded', 'false');
                document.body.style.overflow = '';
            });
        });

        // Close mobile menu when clicking outside
        document.addEventListener('click', function(event) {
            if (!nav.contains(event.target) && !mobileMenuToggle.contains(event.target)) {
                nav.classList.remove('mobile-nav-open');
                mobileMenuToggle.classList.remove('active');
                mobileMenuToggle.setAttribute('aria-expanded', 'false');
                document.body.style.overflow = '';
            }
        });

        // Close mobile menu on window resize if it's open
        window.addEventListener('resize', function() {
            if (window.innerWidth > 768 && nav.classList.contains('mobile-nav-open')) {
                nav.classList.remove('mobile-nav-open');
                mobileMenuToggle.classList.remove('active');
                mobileMenuToggle.setAttribute('aria-expanded', 'false');
                document.body.style.overflow = '';
            }
        });
    }

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
