export interface ContactPayload {
  name: string;
  email: string;
  message: string;
  company?: string;
  phone?: string;
  service?: string;
  budget?: string;
}

// ── Single shared send path for every contact form on the site ──
// (the step-by-step form on the Contact page calls this).
// Wire up your email API here, e.g. EmailJS:
//   import emailjs from '@emailjs/browser';
//   await emailjs.send('SERVICE_ID', 'TEMPLATE_ID', payload, 'PUBLIC_KEY');
// Until that's set up, this simulates a successful send so both forms'
// UI/UX flow can be tested end-to-end.
export async function sendContactEmail(payload: ContactPayload): Promise<boolean> {
  console.log('[contact] would send:', payload);
  await new Promise((resolve) => setTimeout(resolve, 500));
  return true;
}
