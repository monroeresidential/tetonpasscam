import './index.css';
import { hideSeoShell, mount } from './mount';

// The static #seo-shell (index.html) stays byte-frozen in the raw HTML for
// crawlers and no-JS visitors -- see the comment on that element -- but a
// JS-enabled visitor gets the same H1/paragraph rendered again at the
// bottom of the page by <About />, so hide the top static copy the moment
// React actually takes over. `hidden` (not a class) so this degrades to
// "still visible" if this line never runs, rather than depending on a
// stylesheet having loaded.
hideSeoShell();

mount(document.getElementById('root')!);
