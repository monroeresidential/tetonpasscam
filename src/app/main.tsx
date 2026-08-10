import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';

// The static #seo-shell (index.html) stays byte-frozen in the raw HTML for
// crawlers and no-JS visitors -- see the comment on that element -- but a
// JS-enabled visitor gets the same H1/paragraph rendered again at the
// bottom of the page by <About />, so hide the top static copy the moment
// React actually takes over. `hidden` (not a class) so this degrades to
// "still visible" if this line never runs, rather than depending on a
// stylesheet having loaded.
document.getElementById('seo-shell')?.setAttribute('hidden', '');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
