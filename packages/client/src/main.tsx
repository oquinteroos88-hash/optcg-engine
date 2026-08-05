// Card registration side effect must run before anything touches getCardDef.
import './game/decks';

import './styles/global.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

const container = document.getElementById('root');
if (container === null) {
  throw new Error('missing #root element');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
