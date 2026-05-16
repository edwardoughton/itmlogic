import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import '@styles/rack.css';

const el = document.getElementById('root');
if (el) createRoot(el).render(<App />);
