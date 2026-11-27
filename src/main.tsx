import {createRoot} from 'react-dom/client';
import {installFetchInterceptor} from './utils/apiService.ts';
import App from './App.tsx';
import './index.css';

installFetchInterceptor();

createRoot(document.getElementById('root')!).render(<App />);
