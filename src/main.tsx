import React from 'react';
import ReactDOM from 'react-dom/client';
import { CookbookProvider } from './store';
import App from './App';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><CookbookProvider><App /></CookbookProvider></React.StrictMode>);
