import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import HistoryPage from './HistoryPage';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HistoryPage />
  </StrictMode>,
);
