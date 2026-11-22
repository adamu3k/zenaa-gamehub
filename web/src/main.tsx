import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { AppProvider } from './lib/app-context';
import { bootAppearance } from './lib/appearance';
import { applyInitialTheme } from './lib/theme';
import './styles.css';
import './competitions/competitions.css';
import './portal/portal-mobile.css';

bootAppearance();
applyInitialTheme();

const qc = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: true, staleTime: 5_000 } },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={qc}>
      <BrowserRouter>
        <AppProvider>
          <App />
        </AppProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
