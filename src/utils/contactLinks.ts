// Contact details shared by the HUD dock, the Contact page and
// utils/copyEmail.ts. Plain constants (no DOM access), so .astro
// frontmatter can import them at build time.

export const CONTACT_EMAIL = 'hello@primetriskelion.com';

// Booking page behind "Book a call" — the Cal.com account isn't set up
// yet; replace with the real link (e.g. https://cal.com/<username>/intro).
export const BOOKING_URL = 'https://cal.com/';
